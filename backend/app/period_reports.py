"""Saved calendar reports generated from task events, without a model dependency."""
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user
from .db import database
from .models import User, Task, utcnow
from .advanced_models import PeriodReport, ReportSchedule
from .common import enqueue, private_owned, serialize
from .tasks import lock_user
from .statistics import period_statistics

router = APIRouter(prefix='/period-reports')
Kind = Literal['weekly', 'monthly']
SCOPES = {'work': '工作', 'life': '生活', 'study': '学习', 'unassigned': '未分类'}


def bounds(kind, day):
    if kind == 'weekly':
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    start = day.replace(day=1)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return start, next_month - timedelta(days=1)


def next_occurrence(kind, now):
    start, end = bounds(kind, now.date())
    target = datetime.combine(start, time(9), now.tzinfo)
    return start if now < target else end + timedelta(days=1)


def schedule(db, user):
    row = db.scalar(select(ReportSchedule).where(ReportSchedule.user_id == user.id))
    if not row:
        # Callers hold the user lock; new accounts start from registration, even after downtime.
        row = ReportSchedule(user_id=user.id, created_at=user.created_at)
        db.add(row)
        db.flush()
    for kind in ('weekly', 'monthly'):
        if getattr(row, kind + '_next') is None:
            setattr(row, kind + '_next', next_occurrence(kind, row.created_at.astimezone(ZoneInfo(user.timezone))))
    return row


def schedule_reports(db, user, now):
    row = schedule(db, user)
    local = now.astimezone(ZoneInfo(user.timezone))
    for kind in ('weekly', 'monthly'):
        if not getattr(row, kind + '_enabled'):
            continue
        occurrence = getattr(row, kind + '_next')
        # Bound work per tick; later ticks catch up remaining missed occurrences.
        for _ in range(4):
            if local < datetime.combine(occurrence, time(9), local.tzinfo):
                break
            start, _ = bounds(kind, occurrence - timedelta(days=1))
            enqueue(db, user.id, 'period-report', f'period-report:{kind}:{start}:auto',
                    {'kind': kind, 'date': str(start)})
            occurrence = bounds(kind, occurrence)[1] + timedelta(days=1)
        setattr(row, kind + '_next', occurrence)


def elapsed(row):
    return min(row.duration_seconds, row.elapsed_seconds + (
        max(0, int((utcnow() - row.anchor_at).total_seconds())) if row.state == 'running' else 0))


def generate_report(db, user, kind, day, source='manual'):
    if day.year < 1900:
        raise HTTPException(422, '报告日期不能早于 1900 年')
    lock_user(db, user)
    now = utcnow()
    local_day = now.astimezone(ZoneInfo(user.timezone)).date()
    start, end = bounds(kind, day)
    if start > local_day:
        raise HTTPException(422, '不能生成尚未开始的周期报告')
    row = db.scalar(select(PeriodReport).where(PeriodReport.user_id == user.id,
        PeriodReport.kind == kind, PeriodReport.start == start))
    if source == 'auto' and row and not row.partial:
        return row
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id, Task.deleted_at.is_(None))))
    result = period_statistics(db, user, tasks, start, min(end, local_day), elapsed)
    prior_start, prior_end = bounds(kind, start - timedelta(days=1))
    # Compare elapsed days for an open period; whole calendar periods for closed reports.
    comparison_end = min(prior_end, prior_start + timedelta(days=(min(end, local_day) - start).days)) if local_day <= end else prior_end
    previous = period_statistics(db, user, tasks, prior_start, comparison_end, elapsed)['summary']
    carryover = []
    for task in tasks:
        due = task.due_date or (task.due_at.astimezone(ZoneInfo(user.timezone)).date() if task.due_at else None)
        if task.status in ('todo', 'doing') and due and due <= min(end, local_day):
            carryover.append({'task_id': task.id, 'title': task.title, 'due': str(due), 'priority': task.priority,
                'scope':task.scope,'status':task.status})
    carryover.sort(key=lambda task: (task['priority'] != 'high', task['due'], task['task_id']))
    summary = result['summary']
    active_days = sum(bool(day['completed'] or day['created'] or day['focus_seconds']) for day in result['daily'])
    insights = [f"完成 {summary['completed_tasks']} 项任务，新增 {summary['created_tasks']} 项，累计专注 {round(summary['focus_seconds'] / 60)} 分钟；有活动记录的日期共 {active_days} 天。"]
    delta = summary['completed_tasks'] - previous['completed_tasks']
    insights.append(f"比上一{'周' if kind == 'weekly' else '月'}{'同期' if local_day <= end else ''}，完成任务数{'增加' if delta > 0 else '减少' if delta < 0 else '持平'}{f' {abs(delta)} 项' if delta else ''}。")
    if summary['completion_events']:
        peak = max(result['daily'], key=lambda day: day['completed'])
        main = max(result['scopes'], key=result['scopes'].get)
        insights.append(f"完成最多的一天是 {peak['date']}（{peak['completed']} 次）；完成记录主要来自{SCOPES.get(main, '未分类')}（{result['scopes'][main]} 次）。")
    advice = (f"生成时有 {len(carryover)} 项未完成任务的截止日期不晚于报告期末，建议先处理高优先级事项，再为其余事项重新安排时间。" if carryover else
              '生成时没有截止日期不晚于报告期末的未完成任务，可以继续按当前节奏安排下一阶段。')
    content = {**result, 'previous': {**previous, 'start': str(prior_start), 'end': str(comparison_end)},
               'active_days': active_days, 'insights': insights, 'advice': advice, 'carryover': carryover}
    if not row:
        row = PeriodReport(user_id=user.id, kind=kind, start=start)
        db.add(row)
    row.end, row.timezone, row.source = end, user.timezone, source
    row.partial, row.generated_at, row.content = local_day <= end, now, content
    db.flush()
    return row


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Kind
    date: date


class ScheduleInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    weekly_enabled: bool
    monthly_enabled: bool
    version: int


@router.get('/schedule')
def get_schedule(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    return {**serialize(schedule(db, user)), 'timezone': user.timezone, 'time': '09:00'}


@router.put('/schedule')
def update_schedule(body: ScheduleInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    row = schedule(db, user)
    if row.version != body.version:
        raise HTTPException(409, '自动报告设置已更新，请刷新后重试')
    now = utcnow().astimezone(ZoneInfo(user.timezone))
    for kind in ('weekly', 'monthly'):
        enabled = getattr(body, kind + '_enabled')
        if enabled and not getattr(row, kind + '_enabled'):
            setattr(row, kind + '_next', next_occurrence(kind, now))
        setattr(row, kind + '_enabled', enabled)
    row.version += 1
    return {**serialize(row), 'timezone': user.timezone, 'time': '09:00'}


@router.get('')
def list_reports(kind: Kind | None = None, offset: int = 0, user: User = Depends(current_user),
                 db: Session = Depends(database, scope='function')):
    if offset < 0:
        raise HTTPException(422, '分页位置无效')
    query = select(PeriodReport).where(PeriodReport.user_id == user.id)
    if kind:
        query = query.where(PeriodReport.kind == kind)
    rows = db.scalars(query.order_by(PeriodReport.start.desc(), PeriodReport.kind).offset(offset).limit(21))
    items = [{**serialize(row, exclude=('content',)), 'summary': row.content['summary']} for row in rows]
    return {'items': items[:20], 'has_more': len(items) > 20}


@router.post('', status_code=201)
def manual_report(body: GenerateInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return serialize(generate_report(db, user, body.kind, body.date))


@router.get('/{identifier}')
def read_report(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return serialize(private_owned(db, PeriodReport, user.id, identifier))


def redact_report_tasks(db, user_id, ids):
    # Permanent deletion must also erase titles copied into historical reports.
    for row in db.scalars(select(PeriodReport).where(PeriodReport.user_id == user_id)):
        content = row.content
        if any(task['task_id'] in ids for key in ('completed', 'carryover') for task in content.get(key, [])):
            row.content = {**content, **{key: [task for task in content.get(key, []) if task['task_id'] not in ids]
                                       for key in ('completed', 'carryover')}}
