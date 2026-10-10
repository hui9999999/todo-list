"""Durable per-tenant worker. Admin connection discovers IDs only; work uses RLS role."""
import argparse
import logging
import time
import json
from pathlib import Path
from threading import Event, Thread
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import create_engine, select, or_, text
from fastapi import HTTPException
from .config import settings
from .db import SessionFactory, user_context
from .models import User, Task, TaskEvent, TaskSnapshot, OutboxEvent, utcnow
from .advanced_models import Job, AgentRun, RunEvent, EmbeddingProfile, SearchChunk, ProviderConnection, UsageEvent, DeletionMarker
from .common import tenant_session, preferences, enqueue, today, private_owned
from .agent import execute_agent, append_event, reserve_usage
from .memory import cleanup_forget, embedding, embedding_batch
from .embedding_service import ensure_system_profile, profile_connection
from .experience import materialize_recurrences, purge_task, settle_focus
from .recommendations import generate_recommendations
from .period_reports import schedule_reports, generate_report, schedule as report_schedule

log = logging.getLogger('todo.worker')

_discovery_engine = None
_last_heartbeat = 0.0


def discovery_engine():
    # One engine per process; per-tick creation churns pools and connections.
    global _discovery_engine
    if _discovery_engine is None:
        configured = settings().worker_discovery_database_url
        if not configured:
            # deletion_markers has FORCE RLS, so the app role cannot read cross-tenant
            # markers; the owner DSN stays the only working local-dev fallback.
            log.warning('WORKER_DISCOVERY_DATABASE_URL 未配置，使用 owner 迁移凭据发现用户；'
                        '生产环境请配置只读 todo_discovery DSN')
            configured = settings().migration_database_url
        _discovery_engine = create_engine(configured, hide_parameters=True, pool_pre_ping=True)
    return _discovery_engine


def write_heartbeat():
    # /api/v1/health accepts six-minute staleness; once a minute is plenty.
    global _last_heartbeat
    if _last_heartbeat and time.monotonic() - _last_heartbeat < 30:
        return
    heartbeat = Path(settings().deletion_journal_file).parent / 'worker-heartbeat'
    heartbeat.parent.mkdir(parents=True, exist_ok=True)
    heartbeat.write_text(utcnow().isoformat())
    _last_heartbeat = time.monotonic()


def user_ids():
    # Deployment can use a separate discovery role that only SELECTs users.id.
    engine = discovery_engine()
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtext('todo.deletion-journal'))"))
            markers = conn.execute(select(DeletionMarker)).mappings().all()
            payload = json.dumps({'schema_version': 1, 'markers': [dict(m) for m in markers]}, default=str)
            path = Path(settings().deletion_journal_file)
            # Rewrite only on change so the tick loop stays read-only when idle.
            if not path.exists() or path.read_text(encoding='utf-8') != payload:
                # Atomic replacement avoids partial journals. Keep this file on separately backed-up storage.
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix('.tmp')
                tmp.write_text(payload, encoding='utf-8')
                tmp.replace(path)
            return list(conn.scalars(select(User.id)))
    except Exception:
        engine.dispose()
        global _discovery_engine
        _discovery_engine = None
        raise


def schedule_user(user_id):
    with tenant_session(user_id) as db:
        pref = preferences(db, user_id, True)
        user = db.get(User, user_id)
        if not user:
            return
        ensure_system_profile(db, user_id)
        local_now = utcnow().astimezone(ZoneInfo(user.timezone))
        local_day = local_now.date()
        schedule_reports(db, user, local_now)
        for kind, enabled in (('news', pref.news_enabled), ('suggestions', pref.suggestions_enabled)):
            # First enable schedules only the next configured local occurrence.
            target = datetime.combine(local_day, datetime.strptime(pref.recommendation_time, '%H:%M').time(), ZoneInfo(user.timezone))
            if enabled and local_now >= target and pref.updated_at < target:
                key = f'{kind}:{local_day}:{pref.version}:auto'
                enqueue(db, user_id, kind, key, {'date': str(local_day), 'settings_version': pref.version})
        enqueue(db, user_id, 'maintenance', f'maintenance:{local_day}', {})


def index_profile(user_id, profile_id):
    with tenant_session(user_id) as db:
        profile = private_owned(db, EmbeddingProfile, user_id, profile_id)
        if not profile.active or profile.state == 'failed':
            return
        rows = db.execute(select(TaskEvent, TaskSnapshot).join(TaskSnapshot, TaskSnapshot.event_id == TaskEvent.id).join(Task, Task.id == TaskEvent.task_id).where(
            TaskEvent.user_id == user_id, Task.deleted_at.is_(None), ~TaskEvent.id.in_(select(SearchChunk.event_id).where(SearchChunk.user_id == user_id, SearchChunk.profile_id == profile_id))).order_by(TaskEvent.recorded_at).limit(20)).all()
        data = [(e.id, s.after['title'] + '\n' + s.after.get('notes', '')) for e, s in rows]
    if profile.connection_id is None and data:
        with tenant_session(user_id) as db:
            live = private_owned(db, EmbeddingProfile, user_id, profile_id)
            if not live.active:
                return
            connection = profile_connection(db, user_id, live)
            usage = reserve_usage(db, db.get(User, user_id), connection, live.model, 'embedding', 'embedding',
                sum(len(content[:8000]) + 1 for _, content in data))
            usage_id = usage.id
        vectors = embedding_batch(connection, profile.model, [content for _, content in data])
        invalid = len(vectors) != len(data) or any(len(vector) != profile.dimensions for vector in vectors)
        with tenant_session(user_id) as db:
            private_owned(db, UsageEvent, user_id, usage_id).state = 'unknown'
            live = private_owned(db, EmbeddingProfile, user_id, profile_id, True)
            if invalid:
                live.state = 'failed'
            elif live.active:
                for (event_id, _), vector in zip(data, vectors):
                    event = db.scalar(select(TaskEvent).join(Task, Task.id == TaskEvent.task_id).where(
                        TaskEvent.id == event_id, TaskEvent.user_id == user_id, Task.deleted_at.is_(None)))
                    exists = db.scalar(select(SearchChunk.id).where(SearchChunk.user_id == user_id,
                        SearchChunk.profile_id == profile_id, SearchChunk.event_id == event_id))
                    if event and not exists:
                        db.add(SearchChunk(user_id=user_id, profile_id=profile_id, event_id=event_id, embedding=vector))
        if invalid:
            raise HTTPException(502, '向量维度变化')
    for event_id, content in data if profile.connection_id is not None else []:
        with tenant_session(user_id) as db:
            profile = private_owned(db, EmbeddingProfile, user_id, profile_id)
            connection = private_owned(db, ProviderConnection, user_id, profile.connection_id)
            if not profile.active or not connection.enabled:
                return
            usage = reserve_usage(db, db.get(User, user_id), connection, profile.model, 'embedding', 'embedding', len(content[:8000]) + 1)
            usage_id = usage.id
        vector = embedding(connection, profile.model, content)
        with tenant_session(user_id) as db:
            usage = private_owned(db, UsageEvent, user_id, usage_id)
            usage.state = 'unknown'
            profile = private_owned(db, EmbeddingProfile, user_id, profile_id, True)
            event = db.scalar(select(TaskEvent).join(Task, Task.id == TaskEvent.task_id).where(TaskEvent.id == event_id, TaskEvent.user_id == user_id, Task.deleted_at.is_(None)))
            if not event or not profile.active or not private_owned(db, ProviderConnection, user_id, connection.id).enabled:
                continue
            if len(vector) != profile.dimensions:
                profile.state = 'failed'
                raise HTTPException(502, '向量维度变化')
            exists = db.scalar(select(SearchChunk.id).where(SearchChunk.user_id == user_id, SearchChunk.profile_id == profile_id, SearchChunk.event_id == event_id))
            if not exists:
                db.add(SearchChunk(user_id=user_id, profile_id=profile_id, event_id=event_id, embedding=vector))
    with tenant_session(user_id) as db:
        profile = private_owned(db, EmbeddingProfile, user_id, profile_id, True)
        missing = db.scalar(select(TaskEvent.id).join(Task, Task.id == TaskEvent.task_id).where(TaskEvent.user_id == user_id, Task.deleted_at.is_(None),
            ~TaskEvent.id.in_(select(SearchChunk.event_id).where(SearchChunk.user_id == user_id, SearchChunk.profile_id == profile_id))).limit(1))
        if not missing:
            profile.state = 'ready'
            for old in db.scalars(select(EmbeddingProfile).where(EmbeddingProfile.user_id == user_id, EmbeddingProfile.id != profile.id, EmbeddingProfile.state == 'ready')):
                old.active = False
        else:
            enqueue(db, user_id, 'embedding', f'embedding:{profile_id}:{missing}', {'profile_id': profile_id})


def maintenance(user_id):
    with tenant_session(user_id) as db:
        user = db.get(User, user_id)
        materialize_recurrences(db, user)
        expired = list(db.scalars(select(Task).where(Task.user_id == user_id, Task.deleted_at < utcnow() - timedelta(days=30))))
        for task in expired:
            if db.scalar(select(Task.id).where(Task.id == task.id, Task.user_id == user_id)):
                purge_task(db, user, task)


def extend_lease(user_id, job_id, attempt):
    with tenant_session(user_id) as db:
        job = db.scalar(select(Job).where(Job.user_id == user_id, Job.id == job_id).with_for_update())
        if not job or job.state != 'running' or job.attempts != attempt:
            return False
        job.lease_until = utcnow() + timedelta(minutes=5)
    write_heartbeat()
    return True


def maintain_lease(user_id, job_id, attempt, stopped):
    while not stopped.wait(45):
        try:
            if not extend_lease(user_id, job_id, attempt):
                return
        except Exception as error:
            log.error('Lease %s renewal failed: %s', job_id, type(error).__name__)


def process_job(user_id, job_id):
    with tenant_session(user_id) as db:
        job = private_owned(db, Job, user_id, job_id, True)
        if job.state != 'pending' or job.available_at > utcnow():
            return
        job.state, job.lease_until, job.attempts = 'running', utcnow() + timedelta(minutes=5), job.attempts + 1
        kind, payload, attempt = job.kind, job.payload, job.attempts
    stopped = Event()
    heartbeat_thread = Thread(target=maintain_lease, args=(user_id,job_id,attempt,stopped), daemon=True)
    heartbeat_thread.start()
    result = None
    try:
        if kind == 'agent':
            execute_agent(user_id, payload['run_id'])
        elif kind == 'forget':
            with tenant_session(user_id) as db:
                cleanup_forget(db, user_id, payload['request_id'])
        elif kind == 'embedding':
            index_profile(user_id, payload['profile_id'])
        elif kind == 'maintenance':
            maintenance(user_id)
        elif kind in ('news', 'suggestions'):
            result = generate_recommendations(user_id, kind, payload)
        elif kind == 'period-report':
            with tenant_session(user_id) as db:
                user = db.get(User, user_id)
                if user:
                    preferences(db, user_id, True)
                    if getattr(report_schedule(db, user), payload['kind'] + '_enabled'):
                        generate_report(db, user, payload['kind'], datetime.strptime(payload['date'], '%Y-%m-%d').date(), 'auto')
        with tenant_session(user_id) as db:
            job = db.scalar(select(Job).where(Job.user_id == user_id, Job.id == job_id).with_for_update())
            if job and job.state == 'running' and job.attempts == attempt:
                job.state, job.lease_until, job.error = 'completed', None, None
                if kind == 'news' and isinstance(result, dict):
                    job.payload = {**job.payload, 'result': result}
    except Exception as error:
        log.error('Job %s failed: %s', job_id, type(error).__name__)
        with tenant_session(user_id) as db:
            job = db.scalar(select(Job).where(Job.user_id == user_id, Job.id == job_id).with_for_update())
            if job and job.state == 'running' and job.attempts == attempt:
                budget = isinstance(error, HTTPException) and error.status_code == 429
                news_configuration = kind == 'news' and isinstance(error, HTTPException) and error.status_code == 409
                job.state = 'failed' if news_configuration else 'pending' if budget or attempt < 3 else 'failed'
                job.available_at = utcnow() + (timedelta(days=1) if budget else timedelta(seconds=30 * 2 ** attempt))
                job.lease_until, job.error = None, type(error).__name__
                if kind == 'news':
                    job.error = str(error.detail)[:100] if isinstance(error, HTTPException) else '资讯整理失败，请稍后重试'
                if kind == 'agent':
                    run = db.scalar(select(AgentRun).where(AgentRun.user_id == user_id, AgentRun.id == payload['run_id']).with_for_update())
                    if run and run.status == 'running':
                        run.status = 'failed'
                        append_event(db, run, 'error', {'message': '后台运行中断，请重新生成；没有自动执行任务'})
                        append_event(db, run, 'done', {'status': 'failed'})
    finally:
        stopped.set()
        heartbeat_thread.join(timeout=2)


def tick_user(user_id):
    schedule_user(user_id)
    with tenant_session(user_id) as db:
        for expired in db.scalars(select(Job).where(Job.user_id == user_id, Job.state == 'running', Job.lease_until < utcnow()).with_for_update(skip_locked=True)):
            expired.state, expired.lease_until = 'pending', None
            if expired.kind == 'agent':
                run = db.scalar(select(AgentRun).where(AgentRun.id == expired.payload['run_id'], AgentRun.user_id == user_id).with_for_update())
                if run and run.status == 'running':
                    # Partial generation is never re-used as a completed action.
                    run.status = 'failed'
                    append_event(db, run, 'error', {'message': '进程中断，请重新发起；提案未执行'})
                    append_event(db, run, 'done', {'status': 'failed'})
        # New task events enqueue bounded index updates through the transactional outbox.
        profiles = list(db.scalars(select(EmbeddingProfile).where(EmbeddingProfile.user_id == user_id,
            EmbeddingProfile.active, EmbeddingProfile.state != 'failed')))
        latest = db.scalar(select(OutboxEvent).where(OutboxEvent.user_id == user_id).order_by(OutboxEvent.created_at.desc()).limit(1))
        if latest:
            for profile in profiles:
                enqueue(db, user_id, 'embedding', f'embedding:{profile.id}:outbox:{latest.id}', {'profile_id': profile.id})
        ids = list(db.scalars(select(Job.id).where(Job.user_id == user_id, Job.state == 'pending', Job.available_at <= utcnow()).order_by(Job.available_at).limit(20)))
    for job_id in ids:
        process_job(user_id, job_id)
    # Completion-based recurrence needs to react during the day, not only at midnight.
    with tenant_session(user_id) as db:
        user = db.get(User, user_id)
        if user:
            materialize_recurrences(db, user)
            settle_focus(db, user_id)


def tick():
    for user_id in user_ids():
        try:
            tick_user(user_id)
        except Exception as error:
            # A tenant's stale rule or disappearing account must not starve every later tenant.
            log.error('User %s tick failed: %s',user_id,type(error).__name__)
    write_heartbeat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            tick()
        except Exception as error:
            log.error('Worker tick failed: %s', type(error).__name__)
        if args.once:
            break
        # Raising WORKER_TICK_SECONDS sheds per-user lock churn and query load, at the
        # cost of slower pickup of freshly enqueued jobs (agent runs included).
        time.sleep(settings().worker_tick_seconds)


if __name__ == '__main__':
    main()
