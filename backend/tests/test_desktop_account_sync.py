from datetime import timedelta
from sqlalchemy import select
from app.models import DesktopLink, utcnow
from app.db import SessionFactory
from app.common import tenant_session
from app.advanced_models import ProviderConnection
from cryptography.fernet import Fernet

PREFIX = '/api/v1'


def claim(browser, desktop):
    created = browser.post(PREFIX + '/auth/desktop-link')
    assert created.status_code == 201, created.text
    ticket = created.json()['ticket']
    preview = desktop.post(PREFIX + '/auth/desktop-link/preview', json={'token': ticket})
    assert preview.status_code == 200
    assert preview.json()['user']['id'] == browser.user_id
    result = desktop.post(PREFIX + '/auth/desktop-link/claim', json={'token': ticket})
    assert result.status_code == 200, result.text
    assert desktop.post(PREFIX + '/auth/desktop-link/claim', json={'token': ticket}).status_code == 410
    return result.json()['token']


def test_browser_login_switch_and_logout_follow_in_desktop(accounts, monkeypatch):
    browser, other, desktop = accounts(), accounts(), accounts()
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr('app.providers.cipher', lambda: cipher)
    connection = browser.post(PREFIX + '/provider-connections', json={'name':'已保存的测试模型','provider':'deepseek','region':'cn','api_key':'test-only-key'}).json()
    with tenant_session(browser.user_id) as db:
        db.get(ProviderConnection, connection['id']).capabilities = {'deepseek-flash': {'chat':True}}
    assert browser.put(PREFIX + '/model-preferences', json={'connection_id':connection['id'],'model':'deepseek-flash','thinking':'auto'}).status_code == 200
    task = browser.post(PREFIX + '/tasks', json={'title': '第一个账号的任务'}).json()
    token = claim(browser, desktop)
    payload = {'token': token}
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json=payload)
    assert result.status_code == 200
    revision = result.json()['revision']
    assert desktop.get(PREFIX + '/me').json()['user']['id'] == browser.user_id
    assert desktop.get(PREFIX + '/tasks').json()[0]['id'] == task['id']
    assert desktop.get(PREFIX + '/model-preferences').json()['model'] == 'deepseek-flash'
    assert desktop.get(PREFIX + '/provider-connections').json()[0]['id'] == connection['id']
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={**payload, 'revision': revision}).json()['changed'] is False
    result = browser.post(PREFIX + '/auth/login', json={'identifier': other.identifier, 'password': other.password})
    assert result.status_code == 200
    browser.headers['x-csrf-token'] = result.json()['csrf_token']
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json={**payload, 'revision': revision})
    assert result.status_code == 200
    assert result.json()['revision'] != revision
    revision = result.json()['revision']
    assert desktop.get(PREFIX + '/me').json()['user']['id'] == other.user_id
    assert desktop.get(PREFIX + '/tasks').json() == []
    assert desktop.get(PREFIX + '/model-preferences').json() is None
    assert desktop.get(PREFIX + '/provider-connections').json() == []
    assert browser.post(PREFIX + '/auth/logout').status_code == 200
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json={**payload, 'revision': revision})
    assert result.json()['changed'] is True
    assert result.json()['user'] is None
    assert desktop.get(PREFIX + '/me').status_code == 401


def test_pairing_requires_browser_csrf_and_tickets_expire(accounts):
    browser, desktop = accounts(), accounts()
    saved_csrf = browser.headers.pop('x-csrf-token')
    assert browser.post(PREFIX + '/auth/desktop-link').status_code == 403
    browser.headers['x-csrf-token'] = saved_csrf
    ticket = browser.post(PREFIX + '/auth/desktop-link').json()['ticket']
    original = desktop.headers['origin']
    desktop.headers['origin'] = 'https://untrusted.example'
    assert desktop.post(PREFIX + '/auth/desktop-link/claim', json={'token': ticket}).status_code == 403
    desktop.headers['origin'] = original
    with SessionFactory() as db, db.begin():
        row = db.scalar(select(DesktopLink).where(DesktopLink.user_id == browser.user_id))
        row.ticket_expires_at = utcnow() - timedelta(seconds=1)
    assert desktop.post(PREFIX + '/auth/desktop-link/claim', json={'token': ticket}).status_code == 410
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': 'not-a-valid-pairing-token-at-all-123456789'}).status_code == 410


def test_unpaired_browser_cannot_change_link_and_source_session_revocation_logs_out(accounts):
    browser, unrelated, desktop = accounts(), accounts(), accounts()
    token = claim(browser, desktop)
    first = desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token}).json()
    assert unrelated.post(PREFIX + '/auth/login', json={'identifier': unrelated.identifier, 'password': unrelated.password}).status_code == 200
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token, 'revision': first['revision']}).json()
    assert result['changed'] is False
    with SessionFactory() as db, db.begin():
        row = db.scalar(select(DesktopLink).where(DesktopLink.user_id == browser.user_id))
        row.browser_session_id = None
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token, 'revision': first['revision']}).json()
    assert result['changed'] is True
    assert result['user'] is None
    assert desktop.get(PREFIX + '/me').status_code == 401


def test_desktop_can_disconnect_without_logging_out_browser(accounts):
    browser, desktop = accounts(), accounts()
    token = claim(browser, desktop)
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={'token':token}).status_code == 200
    assert desktop.post(PREFIX + '/auth/desktop-link/disconnect', json={'token':token}).status_code == 200
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={'token':token}).status_code == 410
    assert browser.get(PREFIX + '/me').json()['user']['id'] == browser.user_id


def test_reopening_trusted_browser_reuses_link_without_refreshing_native_session(accounts):
    browser, desktop, unrelated = accounts(), accounts(), accounts()
    token = claim(browser, desktop)
    first = desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token}).json()
    ticket = browser.post(PREFIX + '/auth/desktop-link').json()['ticket']
    body = {'token': ticket, 'desktop_token': token}
    assert desktop.post(PREFIX + '/auth/desktop-link/preview', json=body).json()['trusted'] is True
    assert desktop.post(PREFIX + '/auth/desktop-link/preview', json={**body, 'desktop_token': 'x' * 43}).json()['trusted'] is False
    result = desktop.post(PREFIX + '/auth/desktop-link/claim', json=body).json()
    assert result == {'token': token, 'reused': True}
    assert desktop.post(PREFIX + '/auth/desktop-link/claim', json=body).status_code == 410
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token, 'revision': first['revision']}).json()['changed'] is False
    # The same account in another browser is still a separate, untrusted link.
    assert unrelated.post(PREFIX + '/auth/login', json={'identifier': browser.identifier, 'password': browser.password}).status_code == 200
    unrelated.headers['x-csrf-token'] = unrelated.get(PREFIX + '/me').json()['csrf_token']
    other_ticket = unrelated.post(PREFIX + '/auth/desktop-link').json()['ticket']
    assert desktop.post(PREFIX + '/auth/desktop-link/preview', json={'token': other_ticket, 'desktop_token': token}).json()['trusted'] is False
