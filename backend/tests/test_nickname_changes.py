from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app import auth
from app.main import app
from app.common import tenant_session
from app.models import NicknameChange, User

PREFIX = '/api/v1'


def edit(client, nickname):
    return client.put(PREFIX + '/account-profile', json={'nickname': nickname})


def test_daily_limit_noop_validation_identity_and_isolation(accounts):
    client, other = accounts(), accounts()
    assert client.get(PREFIX + '/account-profile').json()['nickname_changes_remaining'] == 2
    for nickname in ('', '   ', '学' * 31):
        assert edit(client, nickname).status_code == 422
    assert client.put(PREFIX + '/account-profile', json={'nickname': '未授权'}, headers={'x-csrf-token': ''}).status_code == 403
    first = edit(client, '  学习伙伴  ')
    assert first.status_code == 200
    assert first.json()['user']['nickname'] == '学习伙伴'
    assert first.json()['user']['identifier'] == client.identifier
    assert first.json()['nickname_changes_remaining'] == 1
    assert edit(client, '学习伙伴').json()['nickname_changes_remaining'] == 1
    assert edit(client, '第二个昵称').json()['nickname_changes_remaining'] == 0
    assert edit(client, '第三个昵称').status_code == 429
    assert edit(client, '第二个昵称').json()['nickname_changes_remaining'] == 0
    assert client.get(PREFIX + '/me').json()['user']['nickname'] == '第二个昵称'
    assert other.get(PREFIX + '/account-profile').json()['nickname_changes_remaining'] == 2
    with tenant_session(other.user_id) as db:
        assert db.scalar(select(func.count()).select_from(NicknameChange)) == 0


def test_limit_resets_at_account_local_midnight(accounts, monkeypatch):
    now = datetime(2026, 10, 2, 15, 59, tzinfo=timezone.utc)
    monkeypatch.setattr(auth, 'utcnow', lambda: now)
    client = accounts()
    with tenant_session(client.user_id) as db:
        db.get(User, client.user_id).timezone = 'Asia/Shanghai'
    assert edit(client, '第一天昵称一').status_code == 200
    assert edit(client, '第一天昵称二').json()['nickname_changes_remaining'] == 0
    quota = client.get(PREFIX + '/account-profile').json()
    assert quota['nickname_reset_at'] == '2026-10-03T00:00:00+08:00'
    now = datetime(2026, 10, 2, 16, 0, tzinfo=timezone.utc)
    assert client.get(PREFIX + '/account-profile').json()['nickname_changes_remaining'] == 2
    assert edit(client, '第二天昵称').json()['nickname_changes_remaining'] == 1


def test_concurrent_sessions_cannot_exceed_two_changes(accounts):
    client = accounts()
    assert edit(client, '第一次修改').status_code == 200
    with TestClient(app, base_url='http://localhost:5173') as peer:
        peer.headers['origin'] = 'http://localhost:5173'
        login = peer.post(PREFIX + '/auth/login', json={'identifier': client.identifier, 'password': client.password})
        assert login.status_code == 200
        peer.headers['x-csrf-token'] = login.json()['csrf_token']
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(edit, client, '并发修改一'), pool.submit(edit, peer, '并发修改二')]
            results = [future.result() for future in futures]
        assert sorted(result.status_code for result in results) == [200, 429]
    assert client.get(PREFIX + '/account-profile').json()['nickname_changes_remaining'] == 0
    with tenant_session(client.user_id) as db:
        assert db.scalar(select(func.count()).select_from(NicknameChange)) == 2
