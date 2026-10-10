import os
import re
import uuid
from pathlib import Path
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

APP_URL = os.environ.get('TEST_DATABASE_URL', 'postgresql+psycopg://todo_app:todo_app_local@127.0.0.1:25432/todo_test')
ADMIN_URL = os.environ.get('TEST_MIGRATION_DATABASE_URL', 'postgresql+psycopg://todo_owner:todo_owner_local@127.0.0.1:25432/todo_test')
assert make_url(APP_URL).database.endswith('_test'), 'Integration tests require a dedicated *_test database'
assert make_url(ADMIN_URL).database == make_url(APP_URL).database
os.environ['DATABASE_URL'] = APP_URL
os.environ['MIGRATION_DATABASE_URL'] = ADMIN_URL
os.environ['APP_ORIGIN'] = 'http://localhost:5173'
# Integration tests never consume the operator's live system credential.
os.environ['SYSTEM_EMBEDDING_API_KEY'] = ''
os.environ['SYSTEM_EMBEDDING_KEY_FILE'] = ''


@pytest.fixture(scope='session', autouse=True)
def test_database():
    from alembic import command
    from alembic.config import Config
    parsed = make_url(ADMIN_URL)
    dbname = parsed.database
    assert re.fullmatch(r'[a-z_]+', dbname)
    admin = create_engine(parsed.set(database='postgres'), isolation_level='AUTOCOMMIT')
    with admin.connect() as conn:
        if not conn.scalar(text('SELECT 1 FROM pg_database WHERE datname=:name'), {'name': dbname}):
            conn.execute(text(f'CREATE DATABASE {dbname}'))
    admin.dispose()
    config = Config(str(Path(__file__).parents[1] / 'alembic.ini'))
    command.upgrade(config, 'head')


@pytest.fixture(autouse=True)
def cleanup(test_database):
    engine = create_engine(ADMIN_URL)
    with engine.begin() as db:
        db.execute(text('TRUNCATE auth_attempts'))
    yield
    with engine.begin() as db:
        db.execute(text("DELETE FROM users WHERE email LIKE 'test-%@example.com'"))
    engine.dispose()


@pytest.fixture
def accounts(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    import app.auth as auth
    captured = []
    real_send = auth.smtplib.SMTP.send_message
    def capture(smtp, message, *args, **kwargs):
        captured.append(message.get_content())
        return real_send(smtp, message, *args, **kwargs)
    monkeypatch.setattr(auth.smtplib.SMTP, 'send_message', capture)
    clients = []
    def create(identifier=None):
        client = TestClient(app, base_url='http://localhost:5173')
        client.headers['origin'] = 'http://localhost:5173'
        email = identifier or f'test-{uuid.uuid4().hex}@example.com'
        password = 'a-strong-test-password'
        result = client.post('/api/v1/auth/register', json={'email': email, 'password': password})
        assert result.status_code == 201, result.text
        assert result.json()['user']['identifier']
        assert result.json()['csrf_token']
        result = client.post('/api/v1/auth/login', json={'email': email, 'password': password})
        assert result.status_code == 200, result.text
        client.headers['x-csrf-token'] = result.json()['csrf_token']
        client.user_id = result.json()['user']['id']
        client.email = result.json()['user']['email']
        client.identifier = result.json()['user']['identifier']
        client.password = password
        client.captured_mail = captured
        clients.append(client)
        return client
    yield create
    for client in clients:
        client.close()
    if clients:
        engine = create_engine(ADMIN_URL)
        with engine.begin() as db:
            for client in clients:
                db.execute(text('DELETE FROM users WHERE id=:id'), {'id': client.user_id})
        engine.dispose()
