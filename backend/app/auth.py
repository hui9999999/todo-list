import hashlib
import secrets
import smtplib
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from email.message import EmailMessage
from urllib.parse import urlencode, urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select, delete, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .config import settings
from .db import database, user_context
from .models import User, NicknameChange, LoginSession, DesktopLink, AuthToken, AuthAttempt, utcnow
from .schemas import Register, Login, EmailRequest, TokenRequest, DesktopSyncInput, DesktopPairingInput, PetPresenceInput, ResetPassword, NicknameUpdate

router = APIRouter()
hasher = PasswordHash.recommended()
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))
COOKIE = 'todo_session'
DESKTOP_COOKIE = 'todo_desktop_link'


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def check_origin(request: Request) -> None:
    config = settings()
    allowed = {config.app_origin}
    origin = urlsplit(config.app_origin)
    # Local HTTP development uses both browser hostnames for the same service.
    if not config.cookie_secure and origin.scheme == 'http' and origin.hostname in ('localhost', '127.0.0.1'):
        port = f':{origin.port}' if origin.port is not None else ''
        allowed.update(f'http://{host}{port}' for host in ('localhost', '127.0.0.1'))
    if request.headers.get('origin') not in allowed:
        raise HTTPException(403, '请求来源不匹配，请从应用页面操作')


def throttle(request: Request, db: Session) -> None:
    key = digest(request.client.host if request.client else 'unknown')
    # Persist failures too, and serialize attempts per IP across web workers.
    with db.bind.begin() as connection:
        connection.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'), {'key': key})
        connection.execute(delete(AuthAttempt).where(AuthAttempt.occurred_at < utcnow() - timedelta(minutes=15)))
        count = connection.scalar(select(func.count()).select_from(AuthAttempt).where(AuthAttempt.key == key))
        if count >= 60:
            raise HTTPException(429, '操作过于频繁，请在 15 分钟后重试')
        connection.execute(AuthAttempt.__table__.insert().values(id=secrets.token_hex(16), key=key, occurred_at=utcnow()))


def issue_email(db: Session, user: User, kind: str) -> None:
    token = secrets.token_urlsafe(32)
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == kind))
    db.add(AuthToken(id=digest(token), user_id=user.id, kind=kind, expires_at=utcnow() + timedelta(hours=1)))
    db.flush()
    msg = EmailMessage()
    msg['From'] = settings().smtp_from
    msg['To'] = user.email
    msg['Subject'] = '验证你的待办账户' if kind == 'verify' else '重置你的待办密码'
    url = settings().app_origin + '/auth?' + urlencode({'mode': kind, 'token': token})
    msg.set_content(f'请在 1 小时内打开以下链接：\n{url}\n如果不是你发起的操作，请忽略此邮件。')
    try:
        with smtplib.SMTP(settings().smtp_host, settings().smtp_port, timeout=10) as smtp:
            if settings().smtp_starttls:
                smtp.starttls()
            if settings().smtp_username:
                smtp.login(settings().smtp_username, settings().smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException):
        raise HTTPException(503, '验证邮件暂时无法发送，请稍后重试') from None


def current_user(request: Request, db: Session = Depends(database, scope='function')) -> User:
    raw = request.cookies.get(COOKIE, '')
    login_session = db.get(LoginSession, digest(raw)) if raw else None
    if not login_session or login_session.expires_at <= utcnow():
        raise HTTPException(401, '请先登录')
    user = db.get(User, login_session.user_id)
    if not user:
        raise HTTPException(401, '请先登录')
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        check_origin(request)
        csrf = request.headers.get('x-csrf-token', '')
        if not csrf or not secrets.compare_digest(csrf, login_session.csrf_token):
            raise HTTPException(403, '安全校验失败，请刷新页面后重试')
    user_context(db, user.id)
    return user


def user_json(user: User) -> dict:
    return {'id': user.id, 'email': user.email, 'phone': user.phone,
            'username': user.username, 'is_admin': user.is_admin,
            'nickname': user.nickname, 'identifier': user.email or user.phone or user.username, 'timezone': user.timezone}


def find_account(db, identifier):
    column = User.email if '@' in identifier else User.phone if identifier.startswith('+') else User.username
    return db.scalar(select(User).where(column == identifier))


def linked_browser(db, request):
    raw = request.cookies.get(DESKTOP_COOKIE)
    if not raw:
        return None
    return db.scalar(select(DesktopLink).where(DesktopLink.browser_hash == digest(raw), DesktopLink.expires_at > utcnow()).with_for_update())


def start_session(db, user, request, response, follow_desktop=True):
    previous = request.cookies.get(COOKIE)
    if previous:
        db.execute(delete(LoginSession).where(LoginSession.id == digest(previous)))
    raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db.add(LoginSession(id=digest(raw), user_id=user.id, csrf_token=csrf, expires_at=utcnow() + timedelta(days=7)))
    if follow_desktop:
        link = linked_browser(db, request)
        if link:
            db.flush()
            link.user_id, link.browser_session_id = user.id, digest(raw)
            link.version += 1
    response.set_cookie(COOKIE, raw, httponly=True, secure=settings().cookie_secure, samesite='lax', max_age=604800, path='/')
    return {'user': user_json(user), 'csrf_token': csrf}


def browser_link(db, request, response, user):
    link = linked_browser(db, request)
    if not link:
        browser_token = secrets.token_urlsafe(32)
        link = DesktopLink(browser_hash=digest(browser_token), expires_at=utcnow() + timedelta(days=30), version=1)
        db.add(link)
        response.set_cookie(DESKTOP_COOKIE, browser_token, httponly=True, secure=settings().cookie_secure, samesite='lax', max_age=2592000, path='/')
    source_id = digest(request.cookies[COOKIE])
    if link.user_id != user.id or link.browser_session_id != source_id:
        link.user_id, link.browser_session_id = user.id, source_id
        link.version += 1
    return link


@router.post('/auth/desktop-link', status_code=201)
def desktop_link(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    link = browser_link(db, request, response, user)
    ticket = secrets.token_urlsafe(32)
    link.ticket_hash, link.ticket_expires_at = digest(ticket), utcnow() + timedelta(seconds=60)
    return {'ticket': ticket, 'expires_in': 60}


@router.post('/auth/desktop-link/presence')
def pet_presence(body: PetPresenceInput, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    link = browser_link(db, request, response, user)
    now = utcnow()
    timestamp = now.timestamp()
    clients = {key: value for key, value in (link.web_clients or {}).items() if value['seen'] > timestamp - 6}
    clients[body.client_id] = {'seen': timestamp, 'hidden': body.hidden}
    link.web_clients = clients
    # This capability belongs to this browser, not every login of the same user.
    active = bool(link.desktop_hash and link.desktop_seen_at and link.desktop_seen_at > now - timedelta(seconds=12))
    return {'desktop_active': active}


def pairing_ticket(db, token):
    link = db.scalar(select(DesktopLink).where(DesktopLink.ticket_hash == digest(token)).with_for_update())
    source = db.get(LoginSession, link.browser_session_id) if link and link.browser_session_id else None
    if not link or link.expires_at <= utcnow() or not link.ticket_expires_at or link.ticket_expires_at <= utcnow() or not source or source.expires_at <= utcnow() or source.user_id != link.user_id:
        raise HTTPException(410, '账号同步链接已失效，请从网页重新打开桌宠')
    return link


@router.post('/auth/desktop-link/preview')
def desktop_link_preview(body: DesktopPairingInput, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    link = pairing_ticket(db, body.token)
    trusted = bool(body.desktop_token and link.desktop_hash and secrets.compare_digest(link.desktop_hash, digest(body.desktop_token)))
    return {'user': user_json(db.get(User, link.user_id)), 'trusted': trusted}


@router.post('/auth/desktop-link/claim')
def desktop_link_claim(body: DesktopPairingInput, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    link = pairing_ticket(db, body.token)
    reused = bool(body.desktop_token and link.desktop_hash and secrets.compare_digest(link.desktop_hash, digest(body.desktop_token)))
    token = body.desktop_token if reused else secrets.token_urlsafe(32)
    link.desktop_hash = digest(token)
    link.ticket_hash, link.ticket_expires_at = None, None
    return {'token': token, 'reused': reused}


@router.post('/auth/desktop-link/session')
def desktop_link_session(body: DesktopSyncInput, request: Request, response: Response, db: Session = Depends(database, scope='function')):
    check_origin(request)
    link = db.scalar(select(DesktopLink).where(DesktopLink.desktop_hash == digest(body.token)).with_for_update())
    if not link or link.expires_at <= utcnow():
        raise HTTPException(410, '网页账号同步已过期，请从网页重新打开桌宠')
    now = utcnow()
    link.desktop_seen_at = now if body.pet_visible else None
    web_visible = any(value['seen'] > now.timestamp() - 6 and not value['hidden'] for value in (link.web_clients or {}).values())
    presence = {'pet_allowed': body.pet_visible and not web_visible, 'pet_lease_ms': 8000}
    source = db.get(LoginSession, link.browser_session_id) if link.browser_session_id else None
    user = db.get(User, link.user_id) if source and source.expires_at > utcnow() and source.user_id == link.user_id else None
    revision = digest(f'{link.version}:{user.id if user else ""}')
    previous = request.cookies.get(COOKIE)
    local_session = db.get(LoginSession, digest(previous)) if previous else None
    same_account = bool(local_session and local_session.expires_at > utcnow() and user and local_session.user_id == user.id) if user else local_session is None
    if body.revision == revision and same_account:
        return {'changed': False, 'revision': revision, **presence}
    if user:
        result = start_session(db, user, request, response, follow_desktop=False)
    else:
        if previous:
            db.execute(delete(LoginSession).where(LoginSession.id == digest(previous)))
        response.delete_cookie(COOKIE, path='/', secure=settings().cookie_secure, httponly=True, samesite='lax')
        result = {'user': None}
    return {**result, 'changed': True, 'revision': revision, **presence}


@router.post('/auth/desktop-link/disconnect')
def desktop_link_disconnect(body: TokenRequest, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    link = db.scalar(select(DesktopLink).where(DesktopLink.desktop_hash == digest(body.token)).with_for_update())
    if link:
        link.desktop_hash = None
        link.desktop_seen_at = None
    return {'message': '已断开网页账号同步'}


@router.post('/auth/register', status_code=201)
def register(body: Register, request: Request, response: Response, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    identifier = body.identifier
    existing = find_account(db, identifier)
    if existing:
        raise HTTPException(409, '该账号已注册，请直接登录')
    user = User(email=identifier if '@' in identifier else None, phone=identifier if '@' not in identifier else None,
                nickname=body.nickname, password_hash=hasher.hash(body.password), timezone=body.timezone, verified=True)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, '该账号已注册，请直接登录') from None
    return {**start_session(db, user, request, response), 'message': '注册成功'}


@router.post('/auth/login')
def login(body: Login, request: Request, response: Response, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    user = find_account(db, body.identifier)
    valid = hasher.verify(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, '账号或密码错误')
    return start_session(db, user, request, response)


@router.get('/me')
def me(request: Request, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    # Stable for the session so refreshing another tab does not invalidate writes.
    login_session = db.get(LoginSession, digest(request.cookies[COOKIE]))
    return {'user': user_json(user), 'csrf_token': login_session.csrf_token}


@router.post('/auth/logout')
def logout(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    db.execute(delete(LoginSession).where(LoginSession.id == digest(request.cookies[COOKIE])))
    response.delete_cookie(COOKIE, path='/', secure=settings().cookie_secure, httponly=True, samesite='lax')
    return {'message': '已退出'}


def nickname_quota(db, user, now):
    local = now.astimezone(ZoneInfo(user.timezone))
    start = datetime.combine(local.date(), time.min, local.tzinfo)
    end = datetime.combine(local.date() + timedelta(days=1), time.min, local.tzinfo)
    used = db.scalar(select(func.count()).select_from(NicknameChange).where(
        NicknameChange.user_id == user.id, NicknameChange.changed_at >= start, NicknameChange.changed_at < end))
    return {'user': user_json(user), 'nickname_changes_remaining': max(0, 2 - used),
            'nickname_reset_at': end.isoformat()}


@router.get('/account-profile')
def account_profile(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return nickname_quota(db, user, utcnow())


@router.put('/account-profile')
def update_nickname(body: NicknameUpdate, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    # Serialize writes from every session; refresh the authenticated object after waiting for the lock.
    user = db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
    now = utcnow()
    quota = nickname_quota(db, user, now)
    if body.nickname == user.nickname:
        return quota
    if quota['nickname_changes_remaining'] == 0:
        raise HTTPException(429, '今天已修改 2 次昵称，请明天再试')
    user.nickname = body.nickname
    db.add(NicknameChange(user_id=user.id, changed_at=now))
    db.flush()
    return nickname_quota(db, user, now)


@router.post('/auth/verify')
def verify(body: TokenRequest, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    token = db.scalar(select(AuthToken).where(AuthToken.id == digest(body.token), AuthToken.kind == 'verify').with_for_update())
    if not token or token.expires_at <= utcnow():
        raise HTTPException(400, '链接已失效，请重新发送验证邮件')
    db.get(User, token.user_id).verified = True
    db.delete(token)
    return {'message': '邮箱已验证，请登录'}


@router.post('/auth/resend-verification')
def resend(body: EmailRequest, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    return {'message': '注册无需验证，请直接登录'}


@router.post('/auth/password-reset')
def request_reset(body: EmailRequest, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if user:
        issue_email(db, user, 'reset')
    return {'message': '如果账户存在，重置邮件已发送'}


@router.post('/auth/password-reset/confirm')
def reset(body: ResetPassword, request: Request, db: Session = Depends(database, scope='function')):
    check_origin(request)
    throttle(request, db)
    token = db.scalar(select(AuthToken).where(AuthToken.id == digest(body.token), AuthToken.kind == 'reset').with_for_update())
    if not token or token.expires_at <= utcnow():
        raise HTTPException(400, '重置链接已失效')
    user = db.get(User, token.user_id)
    user.password_hash = hasher.hash(body.password)
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    return {'message': '密码已重置，请重新登录'}
