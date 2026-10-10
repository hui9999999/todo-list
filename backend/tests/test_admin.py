from datetime import date
import uuid
import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError
from app.config import settings
from app.models import User, Task
from app.db import SessionFactory, user_context
from app.common import tenant_session
from app.advanced_models import UsageEvent
from app.persona import AssistantPersona

PREFIX = '/api/v1/admin'


@pytest.fixture
def administrator(accounts):
    client = accounts()
    engine = create_engine(settings().migration_database_url, hide_parameters=True)
    with Session(engine) as db, db.begin():
        db.execute(update(User).where(User.id == client.user_id).values(is_admin=True))
        baseline = db.get(AssistantPersona, 'default')
        saved = {key: getattr(baseline, key) for key in ('content', 'version', 'updated_at', 'updated_by')}
    yield client
    with Session(engine) as db, db.begin():
        user_context(db, client.user_id)
        db.execute(update(AssistantPersona).where(AssistantPersona.id == 'default').values(**saved))
    engine.dispose()


def add_usage(client, state='settled', input_tokens=40, output_tokens=10, reserved_tokens=500,
              local_date=date(2026, 10, 5), model='model-a'):
    with tenant_session(client.user_id) as db:
        row = UsageEvent(user_id=client.user_id, purpose='chat', provider='deepseek', model=model,
                         mode='fast', state=state, input_tokens=input_tokens, output_tokens=output_tokens,
                         reserved_tokens=reserved_tokens, local_date=local_date)
        db.add(row)
        db.flush()
        return row.id


def test_all_admin_routes_require_admin_and_registration_cannot_escalate(accounts, administrator):
    ordinary = accounts()
    for route in ('/users', '/users/' + ordinary.user_id + '/usage', '/persona'):
        assert ordinary.get(PREFIX + route).status_code == 403
    assert ordinary.put(PREFIX + '/persona', json={'content': '未经授权的人设', 'version': 1}).status_code == 403
    assert ordinary.post('/api/v1/auth/register', json={'identifier': 'test-escalation@example.com', 'password': 'test-password-123', 'is_admin': True}).status_code == 422
    assert ordinary.post('/api/v1/auth/register', json={'identifier': 'admin999', 'password': 'test-password-123'}).status_code == 422
    assert ordinary.get('/api/v1/me').json()['user']['is_admin'] is False
    assert administrator.get('/api/v1/me').json()['user']['is_admin'] is True
    # The ordinary web DB role itself cannot grant permissions, even to an existing admin.
    with pytest.raises(ProgrammingError):
        with SessionFactory() as db, db.begin():
            db.execute(update(User).where(User.id == ordinary.user_id).values(is_admin=True))
    saved_csrf = administrator.headers.pop('x-csrf-token')
    assert administrator.put(PREFIX + '/persona', json={'content': '不能跳过安全校验', 'version': 1}).status_code == 403
    administrator.headers['x-csrf-token'] = saved_csrf
    assert ordinary.post('/api/v1/auth/logout').status_code == 200
    assert ordinary.get(PREFIX + '/users').status_code == 401


def test_usage_read_is_cross_user_only_for_admin_and_never_exposes_private_contents(accounts, administrator):
    first, second, empty = accounts(), accounts(), accounts()
    settled = add_usage(first)
    unknown = add_usage(first, 'unknown', None, None, 9000)
    add_usage(first, local_date=date(2026, 10, 4), input_tokens=100, output_tokens=50)
    add_usage(second, input_tokens=7, output_tokens=3, model='model-b')
    first.post('/api/v1/tasks', json={'title': '私有任务不进入管理界面'})
    with tenant_session(first.user_id) as db:
        assert set(db.scalars(select(UsageEvent.user_id))) == {first.user_id}
        assert db.execute(update(AssistantPersona).values(content='普通用户不能写人设')).rowcount == 0
    with tenant_session(administrator.user_id) as db:
        assert {first.user_id, second.user_id}.issubset(set(db.scalars(select(UsageEvent.user_id))))
        assert list(db.scalars(select(Task).where(Task.user_id == first.user_id))) == []
    result = administrator.get(PREFIX + '/users', params={'q': first.email, 'start': '2026-10-05', 'end': '2026-10-05'}).json()
    assert result['total'] == 1
    usage = result['items'][0]['usage']
    assert usage['input_tokens'] == 40 and usage['output_tokens'] == 10
    assert usage['reported_tokens'] == 50 and usage['calls'] == 2
    assert usage['unreported_calls'] == 1 and usage['unreported_reserved_tokens'] == 9000
    assert result['summary']['reported_tokens'] == 60
    assert result['summary']['unknown_calls'] == 1
    detail = administrator.get(PREFIX + '/users/' + first.user_id + '/usage', params={'start': '2026-10-05', 'end': '2026-10-05'}).json()
    assert detail['summary']['reported_tokens'] == 50
    assert {row['id'] for row in detail['events']} == {settled, unknown}
    assert detail['models'][0]['model'] == 'model-a'
    empty_result = administrator.get(PREFIX + '/users', params={'q': empty.email}).json()['items'][0]
    assert empty_result['usage']['calls'] == 0
    assert administrator.get(PREFIX + '/users', params={'q': '%'}).json()['items'] == []
    assert administrator.get(PREFIX + '/users', params={'page_size': 1}).json()['page_size'] == 1
    assert administrator.get(PREFIX + '/users', params={'start': '2026-10-06', 'end': '2026-10-05'}).status_code == 422
    assert administrator.get(PREFIX + '/users/nonexistent/usage').status_code == 404
    text = administrator.get(PREFIX + '/users').text + str(detail)
    assert 'password_hash' not in text and 'ciphertext' not in text and '私有任务不进入管理界面' not in text


def test_daily_charts_use_all_records_beyond_recent_100_and_respect_user_and_dates(accounts, administrator):
    first, other, empty = accounts(), accounts(), accounts()
    with tenant_session(first.user_id) as db:
        db.add_all([UsageEvent(user_id=first.user_id, purpose='chat', provider='deepseek', model='chart-model', mode='fast',
            state='settled', input_tokens=2, output_tokens=1, reserved_tokens=100, local_date=date(2026, 10, 5)) for _ in range(120)])
    add_usage(first, input_tokens=2000, output_tokens=300, local_date=date(2026, 10, 1))
    add_usage(first, 'unknown', None, None, 500000, local_date=date(2026, 10, 1))
    add_usage(first, input_tokens=8000, output_tokens=1000, local_date=date(2026, 9, 30))
    add_usage(other, input_tokens=99999, output_tokens=99999)
    result = administrator.get(PREFIX + '/users/' + first.user_id + '/usage', params={'start': '2026-10-01', 'end': '2026-10-05'}).json()
    assert len(result['events']) == 100
    assert result['period'] == {'start': '2026-10-01', 'end': '2026-10-05'}
    assert [row['date'] for row in result['daily']] == ['2026-10-01', '2026-10-05']
    assert result['daily'][0]['reported_tokens'] == 2300
    assert result['daily'][0]['unreported_calls'] == 1
    assert result['daily'][1]['reported_tokens'] == 360
    assert sum(row['reported_tokens'] for row in result['daily']) == result['summary']['reported_tokens'] == 2660
    assert result['summary']['calls'] == 122
    assert result['user']['created_at'] and result['user']['verified'] is True
    no_usage = administrator.get(PREFIX + '/users/' + empty.user_id + '/usage', params={'start': '2026-10-01', 'end': '2026-10-05'}).json()
    assert no_usage['daily'] == [] and no_usage['models'] == []
    assert no_usage['summary']['reported_tokens'] == 0 and no_usage['period'] == result['period']
    assert administrator.get(PREFIX + '/users/' + first.user_id + '/usage', params={'start': '2026-10-06', 'end': '2026-10-05'}).status_code == 422


def test_persona_version_validation_and_next_chat_payload(accounts, administrator, monkeypatch):
    import app.agent as agent
    from test_p1_p4 import connection, run_message, output_stream
    from cryptography.fernet import Fernet
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())
    original = administrator.get(PREFIX + '/persona').json()
    new_persona = '你叫小狒，是一位回答简洁、务实的规划伙伴。'
    response = administrator.put(PREFIX + '/persona', json={'content': '  ' + new_persona + '  ', 'version': original['version']})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated['version'] == original['version'] + 1 and updated['content'] == new_persona
    assert updated['updated_by'] == administrator.user_id
    assert administrator.put(PREFIX + '/persona', json={'content': '覆盖过期版本', 'version': original['version']}).status_code == 409
    assert administrator.put(PREFIX + '/persona', json={'content': '   ', 'version': updated['version']}).status_code == 422
    ordinary = accounts()
    connection(ordinary)
    seen = []
    def inspect(c, payload):
        system = payload['messages'][0]['content']
        seen.append(system)
        assert system.startswith(new_persona)
        assert '用户确认后系统执行；不得宣称已执行' in system
        yield from output_stream({'answer': '我来帮你整理计划。'})
    monkeypatch.setattr(agent, 'stream_chat', inspect)
    _, run, _ = run_message(ordinary, '你好')
    agent.execute_agent(ordinary.user_id, run['id'])
    assert len(seen) == 1
    assert ordinary.get('/api/v1/agent-runs/' + run['id']).json()['status'] == 'completed'


def test_administrator_username_login(accounts):
    from app.auth import hasher
    from fastapi.testclient import TestClient
    from app.main import app
    engine = create_engine(settings().migration_database_url, hide_parameters=True)
    username = 'admin_test_' + uuid.uuid4().hex[:10]
    identifier = None
    try:
        with Session(engine) as db, db.begin():
            admin = User(username=username, is_admin=True, password_hash=hasher.hash('test-admin-password-123'), timezone='Asia/Shanghai')
            db.add(admin); db.flush(); identifier = admin.id
        with TestClient(app, base_url='http://localhost:5173') as client:
            response = client.post('/api/v1/auth/login', headers={'Origin': 'http://localhost:5173'}, json={'identifier': username.upper(), 'password': 'test-admin-password-123'})
            assert response.status_code == 200, response.text
            assert response.json()['user']['identifier'] == username and response.json()['user']['is_admin'] is True
            assert client.get(PREFIX + '/users').status_code == 200
            assert client.post('/api/v1/auth/login', headers={'Origin': 'http://localhost:5173'}, json={'identifier': username, 'password': 'wrong-password'}).status_code == 401
    finally:
        if identifier:
            with engine.begin() as db:
                db.execute(User.__table__.delete().where(User.id == identifier))
        engine.dispose()
