import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
import pytest
from sqlalchemy import text, create_engine
from sqlalchemy.exc import DBAPIError
from app.db import engine
from app.models import Task
from app.schemas import TaskFields
from conftest import ADMIN_URL


def create(client, title='买牛奶', **fields):
    response = client.post('/api/v1/tasks', json={'title': title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def update(client, task, **fields):
    values = {k: task[k] for k in TaskFields.model_fields}
    return client.put('/api/v1/tasks/' + task['id'], json={**values, 'version': task['version'], **fields})


def test_email_password_reset_and_revocation(accounts):
    client = accounts()
    response = client.post('/api/v1/auth/password-reset', json={'email': client.email})
    assert response.status_code == 200
    token = parse_qs(urlparse(re.search(r'http://\S+', client.captured_mail[-1]).group()).query)['token'][0]
    response = client.post('/api/v1/auth/password-reset/confirm', json={'token': token, 'password': 'new-long-password'})
    assert response.status_code == 200
    assert client.get('/api/v1/me').status_code == 401
    assert client.post('/api/v1/auth/password-reset/confirm', json={'token': token, 'password': 'new-long-password'}).status_code == 400
    assert client.post('/api/v1/auth/login', json={'email': client.email, 'password': client.password}).status_code == 401
    response = client.post('/api/v1/auth/login', json={'email': client.email, 'password': 'new-long-password'})
    assert response.status_code == 200
    assert 'HttpOnly' in response.headers['set-cookie']
    assert 'SameSite=lax' in response.headers['set-cookie']


def test_csrf_origin_and_stable_multi_tab_session(accounts):
    client = accounts()
    original = client.headers['x-csrf-token']
    assert client.get('/api/v1/me').json()['csrf_token'] == original
    assert client.post('/api/v1/tasks', json={'title': 'x'}, headers={'x-csrf-token': ''}).status_code == 403
    assert client.post('/api/v1/tasks', json={'title': 'x'}, headers={'origin': 'https://elsewhere.example'}).status_code == 403
    create(client)
    assert client.post('/api/v1/auth/logout').status_code == 200
    assert client.get('/api/v1/tasks').status_code == 401


def test_two_user_api_isolation_and_relationships(accounts):
    a, b = accounts(), accounts()
    task = create(a, '客户资料', scope='work')
    assert b.get('/api/v1/tasks').json() == []
    assert b.get('/api/v1/tasks/' + task['id']).status_code == 404
    assert b.get('/api/v1/tasks/' + task['id'] + '/events').status_code == 404
    assert update(b, task, title='越权').status_code == 404
    assert b.post('/api/v1/tasks/' + task['id'] + '/trash', json={'version': 1}).status_code == 404
    assert b.post('/api/v1/tasks', json={'title': '跨账户子任务', 'parent_id': task['id']}).status_code == 404
    assert b.post('/api/v1/daily-plans', json={'task_id': task['id'], 'plan_date': '2026-10-01'}).status_code == 404
    assert b.get('/api/v1/exports').json()['tasks'] == []
    assert a.post('/api/v1/tasks', json={'title': 'x', 'user_id': b.user_id}).status_code == 422


def test_real_rls_role_and_pool_context(accounts):
    a, b = accounts(), accounts()
    task = create(a, '不能被召回')
    with engine.begin() as conn:
        flags = conn.execute(text('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).one()
        assert flags == (False, False)
        assert conn.scalar(text('SELECT count(*) FROM tasks')) == 0
        conn.execute(text("SELECT set_config('app.user_id', :id, true)"), {'id': b.user_id})
        assert conn.scalar(text('SELECT count(*) FROM tasks')) == 0
    with engine.begin() as conn:
        assert conn.scalar(text("SELECT nullif(current_setting('app.user_id', true), '')")) is None
        conn.execute(text("SELECT set_config('app.user_id', :id, true)"), {'id': a.user_id})
        assert conn.scalar(text('SELECT title FROM tasks WHERE id=:id'), {'id': task['id']}) == '不能被召回'
    with pytest.raises(DBAPIError), engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.user_id', :id, true)"), {'id': b.user_id})
        conn.execute(Task.__table__.insert().values(user_id=a.user_id, title='blocked'))


def test_hierarchy_cycles_completion_and_trash_restore(accounts):
    client = accounts()
    root = create(client, '父任务')
    child = create(client, '子任务', parent_id=root['id'])
    grandchild = create(client, '孙任务', parent_id=child['id'])
    assert update(client, root, parent_id=grandchild['id']).status_code == 422
    assert update(client, root, status='done').status_code == 409
    assert update(client, grandchild, status='done').status_code == 200
    assert update(client, child, status='done').status_code == 200
    response = update(client, root, status='done')
    assert response.status_code == 200
    root = response.json()
    assert client.post('/api/v1/tasks', json={'title': '新子任务', 'parent_id': root['id']}).status_code == 409
    response = client.post('/api/v1/tasks/' + root['id'] + '/trash', json={'version': root['version']})
    assert response.json()['count'] == 3
    assert client.get('/api/v1/tasks').json() == []
    deleted = client.get('/api/v1/tasks?trash=true').json()
    root = next(t for t in deleted if t['id'] == root['id'])
    assert client.post('/api/v1/tasks/' + root['id'] + '/restore', json={'version': root['version']}).json()['count'] == 3
    assert len(client.get('/api/v1/tasks').json()) == 3


def test_versions_and_historical_snapshot_survive_rename_reopen(accounts):
    client = accounts()
    first = create(client, '客户汇报')
    done = update(client, first, status='done').json()
    renamed = update(client, done, title='改名后的汇报', status='todo')
    assert renamed.status_code == 200
    assert update(client, first, title='过期写入').status_code == 409
    events = client.get('/api/v1/tasks/' + first['id'] + '/events').json()
    assert len(events) == 3
    completion = events[1]
    assert completion['after']['title'] == '客户汇报'
    assert completion['after']['status'] == 'done'
    assert completion['after']['completed_at'] is not None
    assert renamed.json()['completed_at'] is None
    admin = create_engine(ADMIN_URL)
    with admin.connect() as conn:
        assert conn.scalar(text('SELECT count(*) FROM outbox_events WHERE user_id=:id'), {'id': client.user_id}) == 3
    admin.dispose()


def test_date_semantics_and_plan_idempotency(accounts):
    client = accounts()
    undated = create(client, due_date=None, due_at=None)
    assert undated['due_at'] is None and undated['due_date'] is None
    dated = create(client, due_date='2026-10-01')
    timed = create(client, due_at='2026-10-01T15:00:00+08:00', due_timezone='Asia/Shanghai')
    assert timed['due_at'].startswith('2026-10-01T07:00:00')
    for _ in range(2):
        assert client.post('/api/v1/daily-plans', json={'task_id': dated['id'], 'plan_date': '2026-10-01'}).status_code == 200
    plans = client.get('/api/v1/daily-plans?plan_date=2026-10-01').json()
    assert len(plans) == 1
    latest = client.get('/api/v1/tasks/' + dated['id']).json()
    assert latest['due_date'] == '2026-10-01' and latest['due_at'] is None
    assert latest['version'] == 1
    assert client.post('/api/v1/tasks', json={'title': 'bad', 'due_date': '2026-10-01', 'due_at': '2026-10-01T10:00:00Z', 'due_timezone': 'UTC'}).status_code == 422


def test_v1_import_reconciliation_and_duplicate_confirmation(accounts):
    client, other = accounts(), accounts()
    rows = [
        {'id': 2, 'text': '失败子任务', 'parentId': 1, 'status': 'fail', 'failReason': '等待资料', 'period': 'week', 'notes': '原备注', 'prio': 'high', 'due': '2026-10-03T15:00', 'created': 1700000000000, 'timer': {'min': 25, 'remaining': 123, 'running': True}},
        {'id': 1, 'text': '完成日期未知', 'status': 'done', 'completedAt': None, 'hidden': True},
        {'id': 3, 'text': '确实完成过', 'status': 'done', 'completedAt': 1700001000000, 'due': '2026-10-01'},
    ]
    request = {'content': json.dumps(rows, ensure_ascii=False), 'scope': 'work'}
    response = client.post('/api/v1/imports/preview', json=request)
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch['count'] == 3 and batch['children'] == 1 and batch['issues'] == []
    assert client.get('/api/v1/tasks').json() == []
    assert other.post('/api/v1/imports/' + batch['id'] + '/confirm').status_code == 404
    for _ in range(2):
        assert client.post('/api/v1/imports/' + batch['id'] + '/confirm').json()['count'] == 3
    assert client.post('/api/v1/imports/preview', json=request).json()['confirmed']
    changed_scope = {**request, 'scope': 'life'}
    assert client.post('/api/v1/imports/preview', json=changed_scope).json()['confirmed']
    tasks = client.get('/api/v1/tasks').json()
    assert len(tasks) == 3
    parent = next(t for t in tasks if t['title'] == '完成日期未知')
    child = next(t for t in tasks if t['title'] == '失败子任务')
    assert child['parent_id'] == parent['id'] and child['status'] == 'failed'
    assert child['fail_reason'] == '等待资料' and child['notes'] == '原备注'
    assert child['legacy_period'] == 'week' and child['timer_remaining'] == 123
    assert child['due_at'].startswith('2026-10-03T07:00')
    assert parent['hidden'] and parent['completed_at'] is None
    assert all(t['scope'] == 'work' for t in tasks)
    assert len(client.get('/api/v1/tasks/' + parent['id'] + '/events').json()) == 1
    known = next(t for t in tasks if t['title'] == '确实完成过')
    history = client.get('/api/v1/tasks/' + known['id'] + '/events').json()
    assert len(history) == 2 and history[1]['kind'] == 'imported_completion'
    assert datetime.fromisoformat(history[1]['occurred_at']) == datetime.fromtimestamp(1700001000, timezone.utc)


@pytest.mark.parametrize('rows', [
    [{'id': 1, 'text': 'x', 'parentId': 99}],
    [{'id': 1, 'text': 'x'}, {'id': 1, 'text': 'y'}],
    [{'id': 1, 'text': 'x', 'parentId': 2}, {'id': 2, 'text': 'y', 'parentId': 1}],
    [{'id': 1, 'text': 'x', 'status': 'unknown'}],
    [{'id': 1, 'text': 'x', 'due': '2026-02-30'}],
    [{'id': 1, 'text': 'x', 'timer': {'min': -1}}],
])
def test_invalid_imports_are_visible_and_atomic(accounts, rows):
    client = accounts()
    response = client.post('/api/v1/imports/preview', json={'content': json.dumps(rows)})
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch['issues']
    assert client.post('/api/v1/imports/' + batch['id'] + '/confirm').status_code == 422
    assert client.get('/api/v1/tasks').json() == []


def test_exports_are_private_credential_free_and_v2_task_roundtrip(accounts):
    a, b = accounts(), accounts()
    root = create(a, '父', scope='work', notes='保留备注')
    child = create(a, '子', parent_id=root['id'], scope='life', due_date='2026-10-03')
    child = update(a, child, status='done').json()
    update(a, child, title='子改名', status='todo')
    a.post('/api/v1/daily-plans', json={'task_id': root['id'], 'plan_date': '2026-10-01'})
    exported = a.get('/api/v1/exports').json()
    serialized = json.dumps(exported)
    assert all(secret not in serialized for secret in ('password_hash', 'csrf_token', a.password, 'todo_session', a.user_id))
    assert exported['schema_version'] == 2 and len(exported['tasks']) == 2
    batch = b.post('/api/v1/imports/preview', json={'content': serialized}).json()
    assert not batch['issues']
    assert b.post('/api/v1/imports/' + batch['id'] + '/confirm').status_code == 200
    tasks = b.get('/api/v1/tasks').json()
    parent = next(t for t in tasks if t['title'] == '父')
    child = next(t for t in tasks if t['title'] == '子改名')
    assert child['parent_id'] == parent['id'] and child['scope'] == 'life'
    assert parent['notes'] == '保留备注'
    history = b.get('/api/v1/tasks/' + child['id'] + '/events').json()
    original_completion = next(e for e in history if e['after']['status'] == 'done')
    assert original_completion['actor'] == 'import'
    assert original_completion['after']['title'] == '子'
    assert original_completion['after']['id'] == child['id']
    assert original_completion['after']['parent_id'] == parent['id']
    assert len(b.get('/api/v1/daily-plans?plan_date=2026-10-01').json()) == 1
    assert len(a.get('/api/v1/exports?compat=true').json()) == 2


def test_validation_errors_do_not_echo_secrets(accounts):
    client = accounts()
    response = client.post('/api/v1/auth/login', json={'email': 'invalid', 'password': 'sensitive-password'})
    assert response.status_code == 422
    assert 'sensitive-password' not in response.text


def test_commit_failure_returns_error_and_rolls_back_entire_change(accounts, monkeypatch):
    import app.tasks as service
    from app.models import TaskSnapshot
    original = service.record
    def invalid_snapshot(db, task, *args, **kwargs):
        original(db, task, *args, **kwargs)
        db.add(TaskSnapshot(user_id=task.user_id, event_id='nonexistent-event', after={'title': task.title}))
    monkeypatch.setattr(service, 'record', invalid_snapshot)
    client = accounts()
    response = client.post('/api/v1/tasks', json={'title': '不能虚报成功'})
    assert response.status_code == 503
    assert client.get('/api/v1/tasks').json() == []


def test_legacy_dst_times_require_explicit_offset():
    from app.data import timestamp
    with pytest.raises(ValueError):
        timestamp('2026-03-08T02:30', 'America/New_York')
    with pytest.raises(ValueError):
        timestamp('2026-11-01T01:30', 'America/New_York')
    assert timestamp('2026-11-01T01:30:00-04:00', 'America/New_York').startswith('2026-11-01T05:30')
    assert timestamp('2026-11-01T01:30:00-05:00', 'America/New_York').startswith('2026-11-01T06:30')


def test_v2_trash_batches_restore_separately(accounts):
    a, b = accounts(), accounts()
    first = create(a, '第一组')
    create(a, '第一组子任务', parent_id=first['id'])
    second = create(a, '第二组')
    for root in (first, second):
        assert a.post('/api/v1/tasks/' + root['id'] + '/trash', json={'version': root['version']}).status_code == 200
    backup = a.get('/api/v1/exports').json()
    preview = b.post('/api/v1/imports/preview', json={'content': json.dumps(backup)}).json()
    assert not preview['issues']
    assert b.post('/api/v1/imports/' + preview['id'] + '/confirm').status_code == 200
    deleted = b.get('/api/v1/tasks?trash=true').json()
    root = next(t for t in deleted if t['title'] == '第一组')
    assert b.post('/api/v1/tasks/' + root['id'] + '/restore', json={'version': root['version']}).json()['count'] == 2
    assert len(b.get('/api/v1/tasks?trash=true').json()) == 1


def test_import_error_never_echoes_secret_parser_input(accounts):
    client = accounts()
    rows = [{'id': 1, 'text': 'x', 'due': 'sk-secret-from-file'}]
    response = client.post('/api/v1/imports/preview', json={'content': json.dumps(rows)})
    assert response.status_code == 200
    assert response.json()['issues']
    assert 'sk-secret-from-file' not in response.text
