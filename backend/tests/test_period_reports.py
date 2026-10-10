from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text
from app.common import tenant_session
from app.models import User, Task, TaskEvent, TaskSnapshot
from app.schemas import TaskFields
from app.advanced_models import Job, FocusSession, PeriodReport, ReportSchedule
from app import period_reports as reports

PREFIX = '/api/v1/period-reports'


def stamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def create(client, title, **fields):
    result = client.post('/api/v1/tasks', json={'title': title, 'due_date': None, 'due_at': None, **fields})
    assert result.status_code == 201, result.text
    return result.json()


def done(client, task):
    fields = {key: task[key] for key in TaskFields.model_fields}
    result = client.put('/api/v1/tasks/' + task['id'], json={**fields, 'status': 'done', 'version': task['version']})
    assert result.status_code == 200, result.text
    return result.json()


def completion_at(db, task_id, at):
    event = db.scalar(select(TaskEvent).where(TaskEvent.task_id == task_id, TaskEvent.kind == 'status_changed'))
    snapshot = db.scalar(select(TaskSnapshot).where(TaskSnapshot.event_id == event.id))
    event.occurred_at = stamp(at)
    snapshot.after = {**snapshot.after, 'completed_at': event.occurred_at.isoformat()}


@pytest.mark.parametrize('kind,day,start,end', [
    ('weekly', '2026-01-01', '2025-12-29', '2026-01-04'),
    ('monthly', '2024-02-29', '2024-02-01', '2024-02-29'),
    ('monthly', '2026-12-31', '2026-12-01', '2026-12-31'),
])
def test_calendar_bounds(kind, day, start, end):
    assert reports.bounds(kind, date.fromisoformat(day)) == (date.fromisoformat(start), date.fromisoformat(end))


def test_manual_snapshot_calendar_comparison_and_tenant_privacy(accounts, monkeypatch):
    monkeypatch.setattr(reports, 'utcnow', lambda: stamp('2026-11-03T04:00:00'))
    a, b = accounts(), accounts()
    task = done(a, create(a, '月末学习完成', scope='study'))
    prior = done(a, create(a, '九月完成'))
    carry = create(a, '生成时待处理', priority='high', due_date='2026-10-31')
    done(b, create(b, '别人的秘密'))
    with tenant_session(a.user_id) as db:
        db.get(Task, task['id']).created_at = stamp('2026-10-01T00:00:00')
        db.get(Task, prior['id']).created_at = stamp('2026-09-01T00:00:00')
        completion_at(db, task['id'], '2026-10-31T15:59:59')
        completion_at(db, prior['id'], '2026-09-30T15:59:59')
        db.add(FocusSession(user_id=a.user_id, task_id=task['id'], state='completed',
            duration_seconds=1500, elapsed_seconds=1500, started_at=stamp('2026-10-01T02:00:00'), anchor_at=stamp('2026-10-01T02:00:00')))
    response = a.post(PREFIX, json={'kind': 'monthly', 'date': '2026-10-10'})
    assert response.status_code == 201, response.text
    row = response.json()
    assert (row['start'], row['end'], row['partial']) == ('2026-10-01', '2026-10-31', False)
    assert row['content']['summary']['completed_tasks'] == 1
    assert row['content']['summary']['focus_seconds'] == 1500
    assert row['content']['previous']['start'] == '2026-09-01'
    assert row['content']['previous']['end'] == '2026-09-30'
    assert row['content']['previous']['completed_tasks'] == 1
    assert row['content']['scopes'] == {'study': 1}
    assert row['content']['carryover'][0]['task_id'] == carry['id']
    assert '别人的秘密' not in response.text
    assert b.get(PREFIX).json()['items'] == []
    assert b.get(PREFIX + '/' + row['id']).status_code == 404
    with tenant_session(b.user_id) as db:
        assert db.scalar(select(PeriodReport).where(PeriodReport.id == row['id'])) is None  # RLS too
    repeated = a.post(PREFIX, json={'kind': 'monthly', 'date': '2026-10-31'}).json()
    assert repeated['id'] == row['id']
    assert len(a.get(PREFIX).json()['items']) == 1
    assert a.post('/api/v1/tasks/' + task['id'] + '/trash', json={'version': task['version']}).status_code == 200
    trashed = next(row for row in a.get('/api/v1/tasks?trash=true').json() if row['id'] == task['id'])
    assert a.post('/api/v1/tasks/' + task['id'] + '/purge', json={'version': trashed['version']}).status_code == 200
    clean = a.get(PREFIX + '/' + row['id'])
    assert '月末学习完成' not in clean.text
    assert clean.json()['content']['summary']['completed_tasks'] == 1


def test_partial_report_auto_finalizes_and_manual_refreshes(accounts, monkeypatch):
    now = stamp('2026-10-02T04:00:00')
    monkeypatch.setattr(reports, 'utcnow', lambda: now)
    client = accounts()
    initial = client.post(PREFIX, json={'kind': 'weekly', 'date': '2026-10-02'}).json()
    assert initial['partial'] and len(initial['content']['daily']) == 5
    assert initial['content']['previous']['end'] == '2026-09-25'
    task = done(client, create(client, '随后完成'))
    with tenant_session(client.user_id) as db:
        completion_at(db, task['id'], '2026-10-02T04:00:00')
    updated = client.post(PREFIX, json={'kind': 'weekly', 'date': '2026-09-28'}).json()
    assert updated['id'] == initial['id'] and updated['content']['summary']['completed_tasks'] == 1
    now = stamp('2026-10-05T01:00:00')
    with tenant_session(client.user_id) as db:
        row = reports.generate_report(db, db.get(User, client.user_id), 'weekly', date(2026, 9, 28), 'auto')
        assert not row.partial and row.source == 'auto' and len(row.content['daily']) == 7
        generated_at = row.generated_at
    now += timedelta(days=1)
    with tenant_session(client.user_id) as db:
        row = reports.generate_report(db, db.get(User, client.user_id), 'weekly', date(2026, 9, 28), 'auto')
        assert row.generated_at == generated_at
    assert client.post(PREFIX, json={'kind': 'weekly', 'date': '2026-11-01'}).status_code == 422
    assert client.post(PREFIX, json={'kind': 'daily', 'date': '2026-10-02'}).status_code == 422


def test_durable_schedule_catchup_timezone_dedupe_and_worker(accounts, monkeypatch):
    import app.worker as worker
    now = stamp('2030-01-07T01:00:00')  # Shanghai Monday 09:00, UTC still Jan 7
    monkeypatch.setattr(reports, 'utcnow', lambda: now)
    monkeypatch.setattr(worker, 'utcnow', lambda: now)
    client = accounts()
    with tenant_session(client.user_id) as db:
        user = db.get(User, client.user_id)
        # Activation before Dec 31 Monday and Jan 1 monthly occurrences.
        db.add(ReportSchedule(user_id=user.id, created_at=stamp('2029-12-29T00:00:00')))
    worker.schedule_user(client.user_id)
    worker.schedule_user(client.user_id)
    with tenant_session(client.user_id) as db:
        jobs = list(db.scalars(select(Job).where(Job.kind == 'period-report')))
        assert {(job.payload['kind'], job.payload['date']) for job in jobs} == {
            ('weekly', '2029-12-24'), ('weekly', '2029-12-31'), ('monthly', '2029-12-01')}
        ids = [job.id for job in jobs]
        assert len(jobs) == 3
    for identifier in ids:
        worker.process_job(client.user_id, identifier)
        worker.process_job(client.user_id, identifier)
    assert len(client.get(PREFIX).json()['items']) == 3
    with tenant_session(client.user_id) as db:
        assert all(job.state == 'completed' for job in db.scalars(select(Job).where(Job.id.in_(ids))))
    # Account's local boundary, not server UTC: LA is still Sunday, no weekly job yet.
    other = accounts()
    with tenant_session(other.user_id) as db:
        user = db.get(User, other.user_id)
        user.timezone = 'America/Los_Angeles'
        db.add(ReportSchedule(user_id=user.id, created_at=stamp('2030-01-06T18:00:00')))
    worker.schedule_user(other.user_id)
    with tenant_session(other.user_id) as db:
        assert db.scalar(select(Job).where(Job.kind == 'period-report')) is None


def test_schedule_switch_version_and_reenable_skips_disabled_periods(accounts, monkeypatch):
    now = stamp('2026-10-02T04:00:00')
    monkeypatch.setattr(reports, 'utcnow', lambda: now)
    client = accounts()
    settings = client.get(PREFIX + '/schedule').json()
    assert settings['weekly_enabled'] and settings['monthly_enabled']
    body = {'weekly_enabled': False, 'monthly_enabled': False, 'version': settings['version']}
    assert client.put(PREFIX + '/schedule', json=body).status_code == 200
    assert client.put(PREFIX + '/schedule', json=body).status_code == 409
    now = stamp('2026-12-03T04:00:00')
    with tenant_session(client.user_id) as db:
        reports.schedule_reports(db, db.get(User, client.user_id), now)
        assert db.scalar(select(Job).where(Job.kind == 'period-report')) is None
    body = {'weekly_enabled': True, 'monthly_enabled': True, 'version': 2}
    settings = client.put(PREFIX + '/schedule', json=body).json()
    assert settings['weekly_next'] == '2026-12-07'
    assert settings['monthly_next'] == '2027-01-01'


def test_worker_retry_does_not_lose_report(accounts, monkeypatch):
    import app.worker as worker
    now = stamp('2030-01-07T01:00:00')
    monkeypatch.setattr(reports, 'utcnow', lambda: now)
    monkeypatch.setattr(worker, 'utcnow', lambda: now)
    client = accounts()
    with tenant_session(client.user_id) as db:
        job = Job(user_id=client.user_id, kind='period-report', dedupe_key='retry-report', payload={'kind': 'monthly', 'date': '2029-12-01'})
        db.add(job); db.flush(); identifier = job.id
    real = worker.generate_report
    def fail_once(*args, **kwargs):
        raise RuntimeError('temporary failure')
    monkeypatch.setattr(worker, 'generate_report', fail_once)
    worker.process_job(client.user_id, identifier)
    with tenant_session(client.user_id) as db:
        job = db.get(Job, identifier)
        assert job.state == 'pending' and job.attempts == 1
        now = job.available_at + timedelta(seconds=1)
    monkeypatch.setattr(worker, 'generate_report', real)
    worker.process_job(client.user_id, identifier)
    with tenant_session(client.user_id) as db:
        assert db.get(Job, identifier).state == 'completed'
    assert len(client.get(PREFIX).json()['items']) == 1


def test_backup_deletion_replay_clears_report_titles(accounts):
    from sqlalchemy import create_engine
    from app.config import settings
    from app.backup import replay_markers
    from app.models import uid, utcnow
    from app.common import today
    client = accounts()
    task = done(client, create(client, '备份报告中的敏感标题'))
    with tenant_session(client.user_id) as db:
        day = today(db.get(User, client.user_id))
    row = client.post(PREFIX, json={'kind': 'weekly', 'date': str(day)}).json()
    assert row['content']['completed'][0]['title'] == task['title']
    engine = create_engine(settings().migration_database_url)
    try:
        with engine.begin() as connection:
            replay_markers(connection, {'markers': [{'id': uid(), 'user_id': client.user_id,
                'scope': 'task', 'source_id': task['id'], 'occurred_at': utcnow()}]})
            content = connection.scalar(text('SELECT content FROM period_reports WHERE id=:id'), {'id': row['id']})
            assert content['completed'] == []
            assert task['title'] not in str(content)
    finally:
        engine.dispose()


def test_disabled_schedule_skips_already_queued_automatic_job(accounts):
    import app.worker as worker
    client = accounts()
    settings = client.get(PREFIX + '/schedule').json()
    assert client.put(PREFIX + '/schedule', json={'weekly_enabled': False, 'monthly_enabled': True,
        'version': settings['version']}).status_code == 200
    with tenant_session(client.user_id) as db:
        job = Job(user_id=client.user_id, kind='period-report', dedupe_key='disabled-report',
                  payload={'kind': 'weekly', 'date': '2025-12-29'})
        db.add(job); db.flush(); identifier = job.id
    worker.process_job(client.user_id, identifier)
    assert client.get(PREFIX).json()['items'] == []
    with tenant_session(client.user_id) as db:
        assert db.get(Job, identifier).state == 'completed'
