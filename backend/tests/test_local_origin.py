from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import auth


def request_from(origin):
    headers = [] if origin is None else [(b'origin', origin.encode())]
    return Request({'type': 'http', 'headers': headers})


@pytest.mark.parametrize('configured,origin', [
    ('http://localhost:5173', 'http://127.0.0.1:5173'),
    ('http://127.0.0.1:5173', 'http://localhost:5173'),
])
def test_local_http_origin_accepts_loopback_alias(monkeypatch, configured, origin):
    monkeypatch.setattr(auth, 'settings', lambda: SimpleNamespace(app_origin=configured, cookie_secure=False))
    auth.check_origin(request_from(origin))


@pytest.mark.parametrize('origin', [
    None, 'null', 'http://localhost:5174', 'http://127.0.0.1:5174',
    'https://localhost:5173', 'http://localhost.evil.example:5173',
    'http://127.0.0.2:5173', 'http://0.0.0.0:5173',
    'http://localhost:5173/extra', 'http://user@localhost:5173',
])
def test_local_origin_still_rejects_other_sources(monkeypatch, origin):
    monkeypatch.setattr(auth, 'settings', lambda: SimpleNamespace(app_origin='http://localhost:5173', cookie_secure=False))
    with pytest.raises(HTTPException) as error:
        auth.check_origin(request_from(origin))
    assert error.value.status_code == 403


@pytest.mark.parametrize('configured,secure,origin', [
    ('https://localhost:5173', True, 'https://127.0.0.1:5173'),
    ('http://localhost:5173', True, 'http://127.0.0.1:5173'),
    ('https://todo.example', True, 'https://localhost'),
    ('http://todo.example:5173', False, 'http://127.0.0.1:5173'),
])
def test_other_deployments_require_exact_origin(monkeypatch, configured, secure, origin):
    monkeypatch.setattr(auth, 'settings', lambda: SimpleNamespace(app_origin=configured, cookie_secure=secure))
    auth.check_origin(request_from(configured))
    with pytest.raises(HTTPException) as error:
        auth.check_origin(request_from(origin))
    assert error.value.status_code == 403
