import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.common import tenant_session
from app.models import User, AuthToken
from app import auth

PREFIX = '/api/v1'


def test_email_registration_logs_in_without_mail_or_verification(monkeypatch):
    def unavailable(*args, **kwargs):
        raise AssertionError('Registration must not send email')
    monkeypatch.setattr(auth, 'issue_email', unavailable)
    email = f'test-{uuid.uuid4().hex}@example.com'
    with TestClient(app, base_url='http://localhost:5173') as client:
        client.headers['origin'] = 'http://localhost:5173'
        response = client.post(PREFIX + '/auth/register', json={'identifier': email.upper(), 'password': 'long-registration-password'})
        assert response.status_code == 201, response.text
        result = response.json()
        assert result['user']['identifier'] == result['user']['email'] == email
        assert result['user']['phone'] is None
        assert result['user']['nickname'] is None
        assert 'HttpOnly' in response.headers['set-cookie']
        assert client.get(PREFIX + '/me').json()['user']['id'] == result['user']['id']
        assert client.post(PREFIX + '/tasks', json={'title': '缺少 CSRF'}).status_code == 403
        client.headers['x-csrf-token'] = result['csrf_token']
        assert client.post(PREFIX + '/tasks', json={'title': '注册后立即记录'}).status_code == 201
        with tenant_session(result['user']['id']) as db:
            assert db.scalar(select(AuthToken).where(AuthToken.user_id == result['user']['id'])) is None
        assert client.post(PREFIX + '/auth/resend-verification', json={'email': email}).status_code == 404


def test_phone_normalization_login_duplicates_and_private_data(accounts, monkeypatch):
    monkeypatch.setattr(auth, 'issue_email', lambda *args: (_ for _ in ()).throw(AssertionError('No SMS/email needed')))
    digits = '139' + str(uuid.uuid4().int % 100000000).zfill(8)
    client = accounts(digits)
    expected = '+86' + digits
    assert client.identifier == expected and client.email is None
    task = client.post(PREFIX + '/tasks', json={'title': '电话账号的任务'}).json()
    other = accounts()
    assert other.get(PREFIX + '/tasks/' + task['id']).status_code == 404
    duplicate = other.post(PREFIX + '/auth/register', json={'phone': '+86 ' + digits[:3] + '-' + digits[3:], 'password': 'different-password'})
    assert duplicate.status_code == 409
    assert client.post(PREFIX + '/auth/login', json={'identifier': expected, 'password': 'different-password'}).status_code == 401
    login = client.post(PREFIX + '/auth/login', json={'phone': '+86 (' + digits[:3] + ') ' + digits[3:], 'password': client.password})
    assert login.status_code == 200
    client.headers['x-csrf-token'] = login.json()['csrf_token']
    assert client.get(PREFIX + '/me').json()['user']['phone'] == expected
    assert client.post(PREFIX + '/account-deletion', json={'confirm_email': None}).status_code == 422
    assert client.post(PREFIX + '/account-deletion', json={'confirm_identifier': expected}).status_code == 200
    assert client.get(PREFIX + '/me').status_code == 401


def test_unreachable_email_and_international_phone_are_accepted(accounts):
    # No DNS/deliverability lookup and no domain allowlist.
    email = f'test-{uuid.uuid4().hex}@example.com'
    client = accounts(email)
    response = client.post(PREFIX + '/auth/register', json={'email': 'offline@unreachable.invalid', 'password': 'long-registration-password'})
    assert response.status_code == 201
    identifier = response.json()['user']['identifier']
    client.headers['x-csrf-token'] = response.json()['csrf_token']
    assert client.post(PREFIX + '/account-deletion', json={'confirm_identifier': identifier}).status_code == 200
    international = '+44' + str(uuid.uuid4().int % 10000000000).zfill(10)
    phone = accounts(international)
    assert phone.identifier == international
    assert phone.post(PREFIX + '/auth/login', json={'identifier': international, 'password': phone.password}).status_code == 200


def test_successful_logins_never_trip_the_throttle(accounts):
    # Failures count per IP; successes must not, or a shared NAT gets locked out.
    client = accounts()
    for _ in range(65):
        assert client.post(PREFIX + '/auth/login', json={'email': client.email, 'password': client.password}).status_code == 200


def test_repeated_failures_still_trip_the_throttle(accounts):
    client = accounts()
    for _ in range(60):
        assert client.post(PREFIX + '/auth/login', json={'email': client.email, 'password': 'wrong-password'}).status_code == 401
    assert client.post(PREFIX + '/auth/login', json={'email': client.email, 'password': client.password}).status_code == 429


def test_existing_unverified_account_can_login_and_duplicate_does_not_replace_password(accounts):
    client = accounts()
    with tenant_session(client.user_id) as db:
        db.get(User, client.user_id).verified = False
    assert client.get(PREFIX + '/me').status_code == 200
    assert client.post(PREFIX + '/auth/register', json={'identifier': client.email, 'password': 'changed-by-reregister'}).status_code == 409
    assert client.post(PREFIX + '/auth/login', json={'identifier': client.email, 'password': 'changed-by-reregister'}).status_code == 401
    assert client.post(PREFIX + '/auth/login', json={'email': client.email, 'password': client.password}).status_code == 200


def test_registration_still_validates_format_password_and_origin(accounts):
    client = accounts()
    for identifier in ('not-an-email', '123', 'a@@b.com', 'a@ b.com', '+123abc4567', '1234567890123456'):
        assert client.post(PREFIX + '/auth/register', json={'identifier': identifier, 'password': 'long-registration-password'}).status_code == 422
    assert client.post(PREFIX + '/auth/register', json={'phone': '13800138000', 'password': 'short'}).status_code == 422
    assert client.post(PREFIX + '/auth/register', json={'phone': '13800138000', 'password': 'long-registration-password'},
                       headers={'origin': 'http://elsewhere.invalid'}).status_code == 403
    assert client.post(PREFIX + '/auth/password-reset', json={'email': '13800138000'}).status_code == 422


def test_nickname_persists_without_changing_login_identity(accounts):
    client = accounts()
    password = 'long-registration-password'
    emails = [f'test-{uuid.uuid4().hex}@example.com' for _ in range(2)]
    for email in emails:
        result = client.post(PREFIX + '/auth/register', json={
            'identifier': email, 'password': password, 'nickname': '  学习小伙伴 🌱  ',
        })
        assert result.status_code == 201, result.text
        assert result.json()['user']['nickname'] == '学习小伙伴 🌱'
        assert result.json()['user']['identifier'] == email
        client.headers['x-csrf-token'] = result.json()['csrf_token']
        assert client.post(PREFIX + '/auth/logout').status_code == 200
        login = client.post(PREFIX + '/auth/login', json={'identifier': email, 'password': password})
        assert login.status_code == 200
        assert login.json()['user']['nickname'] == '学习小伙伴 🌱'
        assert client.get(PREFIX + '/me').json()['user'] == login.json()['user']
        with tenant_session(login.json()['user']['id']) as db:
            assert db.get(User, login.json()['user']['id']).nickname == '学习小伙伴 🌱'
        assert client.post(PREFIX + '/auth/register', json={
            'identifier': email, 'password': password, 'nickname': '试图覆盖昵称',
        }).status_code == 409
        assert client.get(PREFIX + '/me').json()['user']['nickname'] == '学习小伙伴 🌱'


def test_nickname_optional_blank_and_length_limit(accounts):
    client = accounts()
    for nickname in ('   ', '学' * 30):
        result = client.post(PREFIX + '/auth/register', json={
            'email': f'test-{uuid.uuid4().hex}@example.com',
            'password': 'long-registration-password', 'nickname': nickname,
        })
        assert result.status_code == 201, result.text
        assert result.json()['user']['nickname'] == (nickname.strip() or None)
    result = client.post(PREFIX + '/auth/register', json={
        'email': f'test-{uuid.uuid4().hex}@example.com',
        'password': 'long-registration-password', 'nickname': '学' * 31,
    })
    assert result.status_code == 422
