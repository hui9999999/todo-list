"""Administrative metadata and usage only; never expose private contents or credentials."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import select, func, case, or_
from sqlalchemy.orm import Session
from .auth import current_user, user_json
from .db import database
from .models import User, utcnow
from .advanced_models import UsageEvent
from .common import serialize, today
from .persona import AssistantPersona, DEFAULT_PERSONA
from .schemas import Strict

router = APIRouter(prefix='/admin', tags=['管理'])


def administrator(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, '仅管理员可以访问管理界面')
    return user


class PersonaInput(Strict):
    content: str = Field(min_length=1, max_length=8000)
    version: int = Field(ge=1)

    @field_validator('content', mode='before')
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


def usage_window(start, end):
    if start and end and end < start:
        raise HTTPException(422, '结束日期不能早于开始日期')
    conditions = []
    if start:
        conditions.append(UsageEvent.local_date >= start)
    if end:
        conditions.append(UsageEvent.local_date <= end)
    return conditions


def usage_columns():
    unreported = or_(UsageEvent.input_tokens.is_(None), UsageEvent.output_tokens.is_(None), UsageEvent.state != 'settled')
    return [
        func.count(UsageEvent.id).label('calls'),
        func.coalesce(func.sum(UsageEvent.input_tokens), 0).label('input_tokens'),
        func.coalesce(func.sum(UsageEvent.output_tokens), 0).label('output_tokens'),
        func.count().filter(UsageEvent.state == 'reserved').label('pending_calls'),
        func.count().filter(UsageEvent.state == 'unknown').label('unknown_calls'),
        func.count().filter(unreported).label('unreported_calls'),
        func.coalesce(func.sum(case((unreported, UsageEvent.reserved_tokens), else_=0)), 0).label('unreported_reserved_tokens'),
    ]


def totals(row):
    result = {key: int(value or 0) for key, value in row.items()}
    result['reported_tokens'] = result['input_tokens'] + result['output_tokens']
    return result


@router.get('/users')
def users(q: str = Query(default='', max_length=100), page: int = Query(default=1, ge=1),
          page_size: int = Query(default=20, ge=1, le=100), start: date | None = None, end: date | None = None,
          user: User = Depends(administrator), db: Session = Depends(database, scope='function')):
    window = usage_window(start, end)
    conditions = []
    if q.strip():
        query = q.strip().lower()
        conditions.append(or_(*(func.lower(column).contains(query, autoescape=True)
                               for column in (User.email, User.phone, User.username, User.nickname))))
    count = db.scalar(select(func.count()).select_from(User).where(*conditions))
    rows = list(db.scalars(select(User).where(*conditions).order_by(User.created_at.desc(), User.id)
                           .offset((page - 1) * page_size).limit(page_size)))
    by_user = {row['user_id']: totals({key: value for key, value in row.items() if key != 'user_id'})
               for row in db.execute(select(UsageEvent.user_id, *usage_columns()).where(*window,
                   UsageEvent.user_id.in_([item.id for item in rows])).group_by(UsageEvent.user_id)).mappings()}
    zero = {column.key: 0 for column in usage_columns()}
    overall = totals(db.execute(select(*usage_columns()).where(*window)).mappings().one())
    overall['total_users'] = db.scalar(select(func.count()).select_from(User))
    return {'items': [{**user_json(item), 'created_at': item.created_at.isoformat(), 'verified': item.verified,
                       'usage': by_user.get(item.id, totals(zero))} for item in rows],
            'total': count, 'page': page, 'page_size': page_size, 'summary': overall}


@router.get('/users/{identifier}/usage')
def user_usage(identifier: str, start: date | None = None, end: date | None = None,
               user: User = Depends(administrator), db: Session = Depends(database, scope='function')):
    target = db.get(User, identifier)
    if not target:
        raise HTTPException(404, '用户不存在')
    window = [UsageEvent.user_id == target.id, *usage_window(start, end)]
    summary = totals(db.execute(select(*usage_columns()).where(*window)).mappings().one())
    grouped = db.execute(select(UsageEvent.provider, UsageEvent.model, *usage_columns()).where(*window)
                         .group_by(UsageEvent.provider, UsageEvent.model).order_by(UsageEvent.provider, UsageEvent.model)).mappings()
    models = [{**{key: row[key] for key in ('provider', 'model')},
               **totals({key: value for key, value in row.items() if key not in ('provider', 'model')})} for row in grouped]
    days = db.execute(select(UsageEvent.local_date, *usage_columns()).where(*window)
                      .group_by(UsageEvent.local_date).order_by(UsageEvent.local_date)).mappings()
    daily = [{'date': row['local_date'].isoformat(),
              **totals({key: value for key, value in row.items() if key != 'local_date'})} for row in days]
    period_end = end or (date.fromisoformat(daily[-1]['date']) if daily else max(start or date.min, today(target)))
    period_start = start or (date.fromisoformat(daily[0]['date']) if daily else max(date.min, period_end - timedelta(days=min(29, period_end.toordinal() - 1))))
    events = list(db.scalars(select(UsageEvent).where(*window).order_by(UsageEvent.created_at.desc(), UsageEvent.id).limit(100)))
    return {'user': {**user_json(target), 'created_at': target.created_at.isoformat(), 'verified': target.verified},
            'summary': summary, 'models': models, 'daily': daily,
            'period': {'start': period_start.isoformat(), 'end': period_end.isoformat()},
            'events': [serialize(row) for row in events]}


@router.get('/persona')
def get_persona(user: User = Depends(administrator), db: Session = Depends(database, scope='function')):
    row = db.get(AssistantPersona, 'default')
    return {**serialize(row), 'default_content': DEFAULT_PERSONA}


@router.put('/persona')
def save_persona(body: PersonaInput, user: User = Depends(administrator), db: Session = Depends(database, scope='function')):
    row = db.scalar(select(AssistantPersona).where(AssistantPersona.id == 'default').with_for_update())
    if row.version != body.version:
        raise HTTPException(409, '人设已被更新，请重新读取后再保存')
    row.content, row.updated_at, row.updated_by = body.content, utcnow(), user.id
    row.version += 1
    db.flush()
    return {**serialize(row), 'default_content': DEFAULT_PERSONA}
