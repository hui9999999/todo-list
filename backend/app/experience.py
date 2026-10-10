"""Calendar, recurrence and focus use actual server dates/events."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import String, or_, select, delete, update
from sqlalchemy.orm import Session
import httpx
from .auth import current_user, user_json
from .db import database
from .models import User, Task, DailyPlanItem, utcnow
from .advanced_models import UserSettings, FocusSession, RecurrenceRule, RecurrenceInstance, Job, UsageEvent, ActionProposal, Project, TaskDependency, DeletionMarker
from .ai_schemas import SettingsInput, NewsTopicsInput, RecurrenceInput, FocusInput, FocusControl, ProjectInput, DependencyInput
from .schemas import VersionRequest, TaskFields
from .common import private_owned, preferences, serialize, enqueue, today
from .tasks import owned, lock_user, task_json, create_task, version_matches, validate_tree
from .statistics import statistics_payload
from .weather_source import load_current_weather

router = APIRouter()


@router.get('/projects')
def projects(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [serialize(row) for row in db.scalars(select(Project).where(Project.user_id == user.id))]


@router.post('/projects', status_code=201)
def create_project(body: ProjectInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = Project(user_id=user.id, **body.model_dump())
    db.add(row)
    db.flush()
    return serialize(row)


@router.get('/tasks/{identifier}/dependencies')
def dependencies(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    owned(db, user, identifier)
    return [serialize(row) for row in db.scalars(select(TaskDependency).where(TaskDependency.user_id == user.id, TaskDependency.task_id == identifier))]


@router.post('/tasks/{identifier}/dependencies')
def add_dependency(identifier: str, body: DependencyInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    task, predecessor = owned(db, user, identifier, True), owned(db, user, body.depends_on_id)
    version_matches(task, body.version)
    if task.deleted_at or predecessor.deleted_at:
        raise HTTPException(409, '不能关联垃圾站任务')
    if task.status == 'done' and predecessor.status not in ('done', 'cancelled'):
        raise HTTPException(409, '已完成任务不能增加未完成依赖')
    edges = list(db.scalars(select(TaskDependency).where(TaskDependency.user_id == user.id)))
    graph = {}
    for edge in edges:
        graph.setdefault(edge.task_id, []).append(edge.depends_on_id)
    stack, seen = [predecessor.id], set()
    while stack:
        node = stack.pop()
        if node == task.id:
            raise HTTPException(422, '依赖不能形成循环')
        if node not in seen:
            seen.add(node)
            stack.extend(graph.get(node, []))
    existing = db.scalar(select(TaskDependency).where(TaskDependency.user_id == user.id, TaskDependency.task_id == task.id, TaskDependency.depends_on_id == predecessor.id))
    if not existing:
        from .tasks import record
        before = task_json(task)
        db.add(TaskDependency(user_id=user.id, task_id=task.id, depends_on_id=predecessor.id))
        task.version, task.updated_at = task.version + 1, utcnow()
        record(db, task, 'dependency_changed', before)
    return {'version': task.version}


@router.delete('/tasks/{identifier}/dependencies/{dependency_id}')
def remove_dependency(identifier: str, dependency_id: str, version: int, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    task = owned(db, user, identifier, True)
    version_matches(task, version)
    edge = private_owned(db, TaskDependency, user.id, dependency_id, True)
    if edge.task_id != identifier:
        raise HTTPException(404, '依赖不存在')
    from .tasks import record
    before = task_json(task)
    db.delete(edge)
    task.version, task.updated_at = task.version + 1, utcnow()
    record(db, task, 'dependency_changed', before)
    return {'version': task.version}


@router.get('/settings')
def get_settings(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return {**serialize(preferences(db, user.id)), 'timezone': user.timezone}


@router.put('/settings')
def set_settings(body: SettingsInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = preferences(db, user.id, True)
    if row.version != body.version:
        raise HTTPException(409, '设置已被另一页面修改，请刷新')
    changed_context = user.timezone != body.timezone or any(getattr(row,key)!=getattr(body,key)
        for key in ('memory_enabled','work_start','work_end','daily_capacity'))
    for key, value in body.model_dump(exclude={'version', 'timezone'}).items():
        if key == 'news_topics' and value is None:
            continue  # Older clients do not overwrite interests they cannot edit.
        setattr(row, key, value)
    user.timezone = body.timezone
    row.version += 1
    row.updated_at = utcnow()
    if changed_context:
        row.context_version += 1
    for job in db.scalars(select(Job).where(Job.user_id == user.id, Job.state == 'pending', Job.kind.in_(('news', 'suggestions')))):
        job.state = 'cancelled'
    return {**serialize(row), 'timezone': user.timezone}


@router.put('/news-topics')
def set_news_topics(body: NewsTopicsInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = preferences(db, user.id, True)
    if row.version != body.version:
        raise HTTPException(409, '关注设置已被另一页面修改，请刷新结果后重试')
    row.news_topics = body.topics
    row.version += 1
    row.updated_at = utcnow()
    for job in db.scalars(select(Job).where(Job.user_id == user.id, Job.state == 'pending', Job.kind.in_(('news', 'suggestions')))):
        job.state = 'cancelled'
    return {**serialize(row), 'timezone': user.timezone}


@router.get('/usage')
def usage(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    rows = list(db.scalars(select(UsageEvent).where(UsageEvent.user_id == user.id, UsageEvent.local_date == today(user)).order_by(UsageEvent.created_at.desc())))
    pref = preferences(db, user.id)
    from .agent import BACKGROUND_PURPOSES
    return {'day': str(today(user)), 'events': [serialize(row) for row in rows], 'chat_calls': sum(r.purpose not in BACKGROUND_PURPOSES for r in rows),
        'background_calls': sum(r.purpose in BACKGROUND_PURPOSES for r in rows), 'background_tokens': sum(r.reserved_tokens for r in rows if r.purpose in BACKGROUND_PURPOSES),
        'call_limit': pref.daily_call_limit, 'token_limit': pref.daily_token_limit, 'note': '未知用量保留预留值；应用限制不等于厂商账单'}


@router.get('/jobs')
def jobs(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [serialize(j, ('payload',)) for j in db.scalars(select(Job).where(Job.user_id == user.id).order_by(Job.available_at.desc()).limit(100))]


@router.get('/calendar')
def calendar(start: date, end: date, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    if end < start or (end - start).days > 92:
        raise HTTPException(422, '日历范围须在 92 天内')
    tasks = list(db.scalars(select(Task).where(
        Task.user_id == user.id, Task.deleted_at.is_(None), Task.hidden.is_(False),
        Task.status.in_(('todo', 'doing', 'done')))))
    zone = ZoneInfo(user.timezone)
    entries = []
    for task in tasks:
        due = task.due_date or (task.due_at.astimezone(zone).date() if task.due_at else None)
        if due and start <= due <= end:
            entries.append({'date': str(due), 'kind': 'due', 'task': task_json(task)})
    by_id = {t.id: t for t in tasks}
    for plan in db.scalars(select(DailyPlanItem).where(DailyPlanItem.user_id == user.id, DailyPlanItem.plan_date.between(start, end))):
        if plan.task_id in by_id:
            entries.append({'date': str(plan.plan_date), 'kind': 'plan', 'plan_id': plan.id, 'task': task_json(by_id[plan.task_id])})
    return entries


@router.get('/statistics')
def statistics(start: date, end: date, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    if end < start or (end - start).days > 366:
        raise HTTPException(422, '统计范围须在一年内')
    return statistics_payload(db, user, start, end, focus_elapsed)


def focus_elapsed(row):
    return min(row.duration_seconds, row.elapsed_seconds + (max(0, int((utcnow() - row.anchor_at).total_seconds())) if row.state == 'running' else 0))


def focus_json(row):
    return {**serialize(row), 'elapsed': focus_elapsed(row), 'server_now': utcnow().isoformat()}


def settle_focus(db, user_id):
    for row in db.scalars(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.state == 'running').with_for_update()):
        if focus_elapsed(row) >= row.duration_seconds:
            row.elapsed_seconds, row.state = row.duration_seconds, 'completed'
            row.version += 1


@router.get('/focus-sessions')
def focus_list(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    settle_focus(db, user.id)
    return [focus_json(row) for row in db.scalars(select(FocusSession).where(FocusSession.user_id == user.id).order_by(FocusSession.started_at.desc()).limit(100))]


@router.post('/focus-sessions', status_code=201)
def focus_start(body: FocusInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    task = owned(db, user, body.task_id)
    if task.deleted_at or task.status in ('done', 'cancelled'):
        raise HTTPException(409, '请选择未完成且有效的任务')
    running = db.scalar(select(FocusSession).where(FocusSession.user_id == user.id, FocusSession.state == 'running'))
    if running:
        if focus_elapsed(running) < running.duration_seconds:
            raise HTTPException(409, '已有专注进行中，请先暂停或结束')
        running.elapsed_seconds, running.state = running.duration_seconds, 'completed'
        running.version += 1
        db.flush()
    row = FocusSession(user_id=user.id, task_id=task.id, duration_seconds=body.minutes * 60)
    db.add(row)
    db.flush()
    return focus_json(row)


@router.post('/focus-sessions/{identifier}')
def focus_control(identifier: str, body: FocusControl, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    row = private_owned(db, FocusSession, user.id, identifier, True)
    if row.version != body.version:
        raise HTTPException(409, '专注已在其他页面变化，请刷新')
    if row.state in ('completed', 'cancelled'):
        return focus_json(row)
    row.elapsed_seconds = focus_elapsed(row)
    if body.action == 'resume':
        task = owned(db, user, row.task_id)
        if task.deleted_at:
            raise HTTPException(409, '请先恢复任务')
        other = db.scalar(select(FocusSession.id).where(FocusSession.user_id == user.id, FocusSession.state == 'running', FocusSession.id != row.id))
        if other:
            raise HTTPException(409, '已有其他专注进行中')
        row.state = 'running'
    else:
        row.state = {'pause': 'paused', 'finish': 'completed', 'cancel': 'cancelled'}[body.action]
    row.anchor_at, row.version = utcnow(), row.version + 1
    return focus_json(row)


def recurrence_next(rule, base):
    if rule.frequency == 'daily':
        return base + timedelta(days=rule.interval)
    if rule.frequency == 'weekly':
        return base + timedelta(weeks=rule.interval)
    target = base + relativedelta(months=rule.interval)
    if rule.mode == 'calendar':
        # Monthly 31st => February's last day, then back to March 31st.
        target = target.replace(day=min(rule.anchor_date.day, (target + relativedelta(day=31)).day))
    return target


def materialize_recurrences(db, user):
    lock_user(db, user)
    local_today = today(user)
    for rule in db.scalars(select(RecurrenceRule).where(RecurrenceRule.user_id == user.id, RecurrenceRule.enabled).with_for_update()):
        if rule.mode == 'after_completion' and rule.next_date is None:
            previous = db.scalar(select(RecurrenceInstance).where(RecurrenceInstance.user_id == user.id, RecurrenceInstance.rule_id == rule.id).order_by(RecurrenceInstance.instance_date.desc()).limit(1))
            task = owned(db, user, previous.task_id) if previous else None
            if task and task.status == 'done' and task.completed_at and not task.deleted_at:
                rule.next_date = max(rule.anchor_date, recurrence_next(rule, task.completed_at.astimezone(ZoneInfo(user.timezone)).date()))
        count = 0
        while rule.next_date and rule.next_date <= local_today and count < 100:
            day = rule.next_date
            existing = db.scalar(select(RecurrenceInstance.id).where(RecurrenceInstance.user_id == user.id, RecurrenceInstance.rule_id == rule.id, RecurrenceInstance.instance_date == day))
            if not existing:
                fields = TaskFields.model_validate({**rule.template, 'due_date': str(day), 'due_at': None, 'due_timezone': None})
                task = create_task(db, user, fields)
                db.add(RecurrenceInstance(user_id=user.id, rule_id=rule.id, task_id=task.id, instance_date=day))
                db.flush()
            rule.next_date = recurrence_next(rule, day) if rule.mode == 'calendar' else None
            count += 1


@router.get('/recurrences')
def recurrences(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [serialize(row) for row in db.scalars(select(RecurrenceRule).where(RecurrenceRule.user_id == user.id))]


@router.post('/recurrences', status_code=201)
def recurrence_add(body: RecurrenceInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return serialize(create_recurrence_rule(db, user, body))


def create_recurrence_rule(db, user, body, source_task=None):
    lock_user(db, user)
    validate_tree(db,user,body.template)
    if source_task:
        if db.scalar(select(RecurrenceInstance.id).join(RecurrenceRule, RecurrenceRule.id == RecurrenceInstance.rule_id).where(
                RecurrenceInstance.user_id == user.id, RecurrenceInstance.task_id == source_task.id, RecurrenceRule.enabled)):
            raise HTTPException(409, '该任务已属于周期任务，不能重复添加周期规则')
    row = RecurrenceRule(user_id=user.id, template=body.template.model_dump(mode='json'), frequency=body.frequency,
        interval=body.interval, mode=body.mode, anchor_date=body.start_date, next_date=body.start_date)
    db.add(row)
    db.flush()
    if source_task:
        day = today(user)
        db.add(RecurrenceInstance(user_id=user.id, rule_id=row.id, task_id=source_task.id, instance_date=day))
        if row.mode == 'after_completion':
            row.next_date = None
        elif body.start_date <= day:
            row.next_date = recurrence_next(row, day)
        db.flush()
    materialize_recurrences(db, user)
    return row


@router.put('/recurrences/{identifier}')
def recurrence_change(identifier: str, body: RecurrenceInput, version: int, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    row = private_owned(db, RecurrenceRule, user.id, identifier, True)
    if row.version != version:
        raise HTTPException(409, '规则已变化')
    validate_tree(db,user,body.template)
    row.template, row.frequency, row.interval, row.mode = body.template.model_dump(mode='json'), body.frequency, body.interval, body.mode
    row.anchor_date, row.next_date, row.version = body.start_date, body.start_date, row.version + 1
    materialize_recurrences(db, user)
    return serialize(row)


@router.delete('/recurrences/{identifier}')
def recurrence_disable(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = private_owned(db, RecurrenceRule, user.id, identifier, True)
    row.enabled, row.version = False, row.version + 1
    return {'message': '后续实例已停止；已有任务仍保留'}


def purge_task(db, user, root):
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id)))
    ids = {root.id}
    while True:
        expanded = ids | {t.id for t in tasks if t.parent_id in ids}
        if expanded == ids:
            break
        ids = expanded
    if any(t.id in ids and not t.deleted_at for t in tasks):
        raise HTTPException(409, '子任务仍有效，请先移入垃圾站')
    from .period_reports import redact_report_tasks
    redact_report_tasks(db, user.id, ids)
    # Remove saved preview/body copies referencing deleted tasks, retaining minimal source blocks.
    affected_runs = set()
    for row in db.scalars(select(ActionProposal).where(ActionProposal.user_id == user.id)):
        if any(a.get('task_id') in ids for a in row.actions) or any(b.get('id') in ids for b in row.before) or any(
                r.get('task_id') in ids or any(instance.get('task_id') in ids for instance in r.get('recurrence', {}).get('instances', [])) for r in row.result):
            if row.run_id:
                affected_runs.add(row.run_id)
            row.actions, row.before, row.result, row.reason, row.state = [], [], [], '', 'expired'
    from .advanced_models import RunEvent, AgentRun, Message, ForgetRequest
    preferences(db, user.id, True).context_version += 1
    for identifier in ids:
        db.add(ForgetRequest(user_id=user.id, source_id=identifier, state='completed'))
        db.add(DeletionMarker(user_id=user.id, scope='task', source_id=identifier))
    # Task facts may have been quoted by old assistant messages. Only runs, events and
    # assistant answers that actually reference the purged tasks are cleared, so unrelated
    # conversations and audit history survive; ids are unique, titles only over-match.
    markers = sorted(str(value) for value in ids | {t.title for t in tasks if t.id in ids and t.title})
    def referencing(*columns):
        return or_(False, *[column.cast(String).contains(value) for column in columns for value in markers])
    affected_runs.update(db.scalars(select(AgentRun.id).where(AgentRun.user_id == user.id,
        referencing(AgentRun.answer, AgentRun.clarification.cast(String)))))
    affected_runs.update(db.scalars(select(RunEvent.run_id).where(RunEvent.user_id == user.id,
        referencing(RunEvent.payload.cast(String)))))
    if affected_runs:
        db.execute(update(AgentRun).where(AgentRun.user_id == user.id, AgentRun.id.in_(affected_runs)).values(answer='', clarification=None))
        db.execute(delete(RunEvent).where(RunEvent.user_id == user.id, RunEvent.run_id.in_(affected_runs)))
        conversations = set(db.scalars(select(AgentRun.conversation_id).where(AgentRun.user_id == user.id, AgentRun.id.in_(affected_runs))))
        wiped = or_(Message.conversation_id.in_(conversations), referencing(Message.content))
    else:
        wiped = referencing(Message.content)
    for msg in db.scalars(select(Message).where(Message.user_id == user.id, Message.role == 'assistant', wiped)):
        msg.content = '[相关事实已删除，派生回答已清理]'
    for t in tasks:
        if t.id in ids:
            t.parent_id = None
    db.flush()
    db.execute(delete(Task).where(Task.user_id == user.id, Task.id.in_(ids)))
    return len(ids)


@router.post('/tasks/{identifier}/purge')
def permanent_delete(identifier: str, body: VersionRequest, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    row = owned(db, user, identifier, True)
    version_matches(row, body.version)
    if not row.deleted_at:
        raise HTTPException(409, '只能永久删除垃圾站中的任务')
    return {'count': purge_task(db, user, row)}


@router.get('/weather')
def weather(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    pref = preferences(db, user.id)
    if not pref.weather_enabled:
        return {'enabled': False}
    return load_current_weather(pref.weather_city, user.timezone)


@router.post('/account-deletion')
def delete_account(body: dict, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    if body != {'confirm_identifier': user.email or user.phone} and (not user.email or body != {'confirm_email': user.email}):
        raise HTTPException(422, '请输入当前账号以确认删除账户')
    lock_user(db, user)
    db.add(DeletionMarker(user_id=user.id, scope='account', source_id=user.id))
    db.delete(user)
    return {'state': 'completed', 'message': '在线账户、任务、对话、记忆及凭据已删除；备份按保留策略清理'}
