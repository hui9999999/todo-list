"""Evidence-based period metrics; current task distributions stay separate."""
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .models import Task, TaskEvent, TaskSnapshot
from .advanced_models import FocusSession


def period_statistics(db, user, tasks, start, end, elapsed):
    zone = ZoneInfo(user.timezone)
    begin = datetime.combine(start, datetime.min.time(), zone)
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), zone)
    days = {}
    for offset in range((end - start).days + 1):
        day = str(start + timedelta(days=offset))
        days[day] = {'date': day, 'completed': 0, 'created': 0, 'focus_seconds': 0}

    completed, scopes, priorities = [], Counter(), Counter()
    rows = db.execute(
        select(TaskEvent, TaskSnapshot)
        .join(TaskSnapshot, (TaskSnapshot.event_id == TaskEvent.id) & (TaskSnapshot.user_id == TaskEvent.user_id))
        .join(Task, (Task.id == TaskEvent.task_id) & (Task.user_id == TaskEvent.user_id))
        .where(TaskEvent.user_id == user.id, Task.deleted_at.is_(None),
               TaskEvent.occurred_at >= begin, TaskEvent.occurred_at < finish)
        .order_by(TaskEvent.occurred_at.desc(), TaskEvent.id)
    )
    for event, snap in rows:
        actual = event.kind == 'imported_completion' or (
            event.kind in ('created', 'status_changed') and snap.after.get('status') == 'done'
            and (not snap.before or snap.before.get('status') != 'done')
        )
        if actual and snap.after.get('completed_at'):
            day = str(event.occurred_at.astimezone(zone).date())
            scope = snap.after.get('scope', 'unassigned')
            priority = snap.after.get('priority', 'mid')
            days[day]['completed'] += 1
            scopes[scope] += 1
            priorities[priority] += 1
            completed.append({'event_id': event.id, 'task_id': event.task_id,
                              'title': snap.after['title'], 'occurred_at': event.occurred_at.isoformat(),
                              'date': day, 'scope': scope, 'priority': priority})

    # Task creation and completion are independent: an older task can finish this period.
    for task in tasks:
        if begin <= task.created_at < finish:
            days[str(task.created_at.astimezone(zone).date())]['created'] += 1

    focuses = db.scalars(select(FocusSession).where(
        FocusSession.user_id == user.id, FocusSession.started_at >= begin,
        FocusSession.started_at < finish, FocusSession.state != 'cancelled'))
    for row in focuses:
        # Pauses have no interval history; attribute recorded duration to its start date.
        days[str(row.started_at.astimezone(zone).date())]['focus_seconds'] += elapsed(row)

    summary = {'completed_tasks': len({row['task_id'] for row in completed}),
               'completion_events': len(completed),
               'created_tasks': sum(day['created'] for day in days.values()),
               'focus_seconds': sum(day['focus_seconds'] for day in days.values())}
    return {'summary': summary, 'daily': list(days.values()), 'completed': completed,
            'scopes': dict(scopes), 'completion_priorities': dict(priorities)}


def statistics_payload(db, user, start, end, elapsed):
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id, Task.deleted_at.is_(None))))
    result = period_statistics(db, user, tasks, start, end, elapsed)
    previous_end = start - timedelta(days=1)
    previous_start = start - timedelta(days=(end - start).days + 1)
    previous = period_statistics(db, user, tasks, previous_start, previous_end, elapsed)
    return {**result, 'states': dict(Counter(task.status for task in tasks)),
            'completion_events': result['summary']['completion_events'],
            'focus_seconds': result['summary']['focus_seconds'],
            'trend': {day['date']: day['completed'] for day in result['daily']},
            'previous': {**previous['summary'], 'start': previous_start, 'end': previous_end},
            'start': start, 'end': end}
