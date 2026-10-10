from datetime import timedelta
from sqlalchemy import select
from app.db import SessionFactory
from app.models import DesktopLink, utcnow
from test_desktop_account_sync import PREFIX, claim


def presence(browser, hidden=False):
    result = browser.post(PREFIX + '/auth/desktop-link/presence', json={'hidden': hidden})
    assert result.status_code == 200, result.text
    return result.json()


def test_web_pet_is_default_and_desktop_waits_for_web_to_hide(accounts):
    browser, desktop = accounts(), accounts()
    assert presence(browser)['desktop_active'] is False
    token = claim(browser, desktop)
    body = {'token': token, 'pet_visible': True}
    waiting = desktop.post(PREFIX + '/auth/desktop-link/session', json=body)
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()['pet_allowed'] is False
    assert presence(browser)['desktop_active'] is True
    presence(browser, hidden=True)
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json=body).json()['pet_allowed'] is True
    # Keep-alive with an unchanged login revision still renews the pet lease.
    body['revision'] = waiting.json()['revision']
    result = desktop.post(PREFIX + '/auth/desktop-link/session', json=body).json()
    assert result['changed'] is False
    assert result['pet_allowed'] is True
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={**body, 'pet_visible': False}).status_code == 200
    assert presence(browser)['desktop_active'] is False


def test_presence_is_scoped_to_browser_and_expires_after_desktop_exit(accounts):
    browser, desktop, other = accounts(), accounts(), accounts()
    token = claim(browser, desktop)
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token}).status_code == 200
    assert presence(browser)['desktop_active'] is True
    # Logging into the same account elsewhere must not hide that computer's web pet.
    result = other.post(PREFIX + '/auth/login', json={'identifier': browser.identifier, 'password': browser.password})
    other.headers['x-csrf-token'] = result.json()['csrf_token']
    assert presence(other)['desktop_active'] is False
    with SessionFactory() as db, db.begin():
        row = db.scalar(select(DesktopLink).where(DesktopLink.desktop_hash.is_not(None), DesktopLink.user_id == browser.user_id))
        row.desktop_seen_at = utcnow() - timedelta(seconds=13)
    assert presence(browser)['desktop_active'] is False


def test_presence_requires_csrf_and_disconnect_releases_desktop(accounts):
    browser, desktop = accounts(), accounts()
    token = claim(browser, desktop)
    desktop.post(PREFIX + '/auth/desktop-link/session', json={'token': token})
    csrf = browser.headers.pop('x-csrf-token')
    assert browser.post(PREFIX + '/auth/desktop-link/presence', json={'hidden': True}).status_code == 403
    browser.headers['x-csrf-token'] = csrf
    assert presence(browser)['desktop_active'] is True
    desktop.post(PREFIX + '/auth/desktop-link/disconnect', json={'token': token})
    assert presence(browser)['desktop_active'] is False


def test_desktop_waits_for_every_visible_tab(accounts):
    browser, desktop = accounts(), accounts()
    for client in ['tab-a', 'tab-b']:
        assert browser.post(PREFIX + '/auth/desktop-link/presence', json={'client_id': client, 'hidden': False}).status_code == 200
    token = claim(browser, desktop)
    browser.post(PREFIX + '/auth/desktop-link/presence', json={'client_id': 'tab-a', 'hidden': True})
    body = {'token': token, 'pet_visible': True}
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json=body).json()['pet_allowed'] is False
    browser.post(PREFIX + '/auth/desktop-link/presence', json={'client_id': 'tab-b', 'hidden': True})
    assert desktop.post(PREFIX + '/auth/desktop-link/session', json=body).json()['pet_allowed'] is True
