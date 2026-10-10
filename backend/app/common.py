from contextlib import contextmanager
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from sqlalchemy import select
from .db import SessionFactory, user_context
from .models import User, utcnow
from .advanced_models import UserSettings, Job


@contextmanager
def tenant_session(user_id):
    with SessionFactory() as db, db.begin():
        user_context(db, user_id)
        yield db


def private_owned(db, model, user_id, identifier, lock=False):
    query = select(model).where(model.user_id == user_id, model.id == identifier)
    row = db.scalar(query.with_for_update() if lock else query)
    if not row:
        raise HTTPException(404, '记录不存在')
    return row


def preferences(db, user_id, lock=False):
    if lock:
        db.scalar(select(User).where(User.id == user_id).with_for_update())
    row = db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
    if not row:
        db.scalar(select(User).where(User.id == user_id).with_for_update())
        row = db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
        if not row:
            row = UserSettings(user_id=user_id)
            db.add(row)
            db.flush()
    return row


def serialize(row, exclude=()):
    result = {}
    for col in row.__table__.columns:
        if col.name in ('user_id', *exclude):
            continue
        value = getattr(row, col.name)
        result[col.name] = value.isoformat() if hasattr(value, 'isoformat') else value
    return result


def today(user):
    return utcnow().astimezone(ZoneInfo(user.timezone)).date()


def enqueue(db, user_id, kind, key, payload):
    existing = db.scalar(select(Job).where(Job.user_id == user_id, Job.dedupe_key == key))
    if existing:
        return existing
    job = Job(user_id=user_id, kind=kind, dedupe_key=key, payload=payload)
    db.add(job)
    db.flush()
    return job
