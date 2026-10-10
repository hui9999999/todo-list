from datetime import datetime, timezone
from sqlalchemy import select

from app.common import tenant_session
from app.models import Task, TaskEvent, TaskSnapshot
from app.advanced_models import FocusSession

PREFIX = '/api/v1'


def stamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def create(client, title, scope='work'):
    response = client.post(PREFIX + '/tasks', json={'title': title, 'scope': scope})
    assert response.status_code == 201, response.text
    return response.json()


def status(client, task, value):
    response = client.put(PREFIX + '/tasks/' + task['id'], json={
        'title': task['title'], 'scope': task['scope'], 'version': task['version'], 'status': value})
    assert response.status_code == 200, response.text
    return response.json()


def date_completions(db, task_id, dates):
    events = list(db.scalars(select(TaskEvent).where(TaskEvent.task_id == task_id,
        TaskEvent.kind == 'status_changed').order_by(TaskEvent.occurred_at)))
    i = 0
    for event in events:
        snap = db.scalar(select(TaskSnapshot).where(TaskSnapshot.event_id == event.id))
        if snap.after['status'] == 'done':
            event.occurred_at = stamp(dates[i])
            snap.after = {**snap.after, 'completed_at': event.occurred_at.isoformat()}
            i += 1
    assert i == len(dates)


def test_statistics_daily_timezone_dedup_comparison_and_privacy(accounts):
    a, b = accounts(), accounts()
    repeated = status(a, create(a, '重复完成'), 'done')
    repeated = status(a, status(a, repeated, 'todo'), 'done')
    new = create(a, '期间新增', 'life')
    prior = status(a, create(a, '上期完成'), 'done')
    cancelled = status(a, create(a, '取消不是完成'), 'cancelled')
    deleted = status(a, create(a, '已删除完成'), 'done')
    assert a.post(PREFIX + '/tasks/' + deleted['id'] + '/trash', json={'version': deleted['version']}).status_code == 200
    foreign = status(b, create(b, '其他账户完成'), 'done')
    with tenant_session(a.user_id) as db:
        for row, at in [(repeated, '2026-09-29T04:00:00'), (new, '2026-10-02T04:00:00'),
                        (prior, '2026-09-29T04:00:00'), (cancelled, '2026-10-01T04:00:00')]:
            db.get(Task, row['id']).created_at = stamp(at)
        # UTC Sep 30 is Oct 1 in the account timezone; the end boundary is exclusive.
        date_completions(db, repeated['id'], ['2026-09-30T16:30:00', '2026-10-02T15:59:59'])
        date_completions(db, prior['id'], ['2026-09-29T04:00:00'])
        date_completions(db, deleted['id'], ['2026-10-01T04:00:00'])
        for state, at, seconds in [('paused', '2026-09-30T16:30:00', 60),
                                   ('completed', '2026-10-02T04:00:00', 600),
                                   ('cancelled', '2026-10-02T04:00:00', 900),
                                   ('completed', '2026-09-29T04:00:00', 120)]:
            db.add(FocusSession(user_id=a.user_id, task_id=repeated['id'], state=state,
                duration_seconds=1500, elapsed_seconds=seconds, started_at=stamp(at), anchor_at=stamp(at)))
    with tenant_session(b.user_id) as db:
        date_completions(db, foreign['id'], ['2026-10-01T04:00:00'])
    response = a.get(PREFIX + '/statistics?start=2026-10-01&end=2026-10-03')
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['summary'] == {'completed_tasks': 1, 'completion_events': 2, 'created_tasks': 2, 'focus_seconds': 660}
    assert result['daily'] == [
        {'date': '2026-10-01', 'completed': 1, 'created': 1, 'focus_seconds': 60},
        {'date': '2026-10-02', 'completed': 1, 'created': 1, 'focus_seconds': 600},
        {'date': '2026-10-03', 'completed': 0, 'created': 0, 'focus_seconds': 0}]
    assert result['previous'] == {'completed_tasks': 1, 'completion_events': 1, 'created_tasks': 2,
        'focus_seconds': 120, 'start': '2026-09-28', 'end': '2026-09-30'}
    assert result['scopes'] == {'work': 2}
    assert [row['date'] for row in result['completed']] == ['2026-10-02', '2026-10-01']
    assert {row['task_id'] for row in result['completed']} == {repeated['id']}
    assert result['states'] == {'done': 2, 'todo': 1, 'cancelled': 1}
    assert result['focus_seconds'] == 660 and result['completion_events'] == 2
    assert result['trend']['2026-10-03'] == 0


def test_statistics_empty_range_validation_and_inclusive_end(accounts):
    client = accounts()
    result = client.get(PREFIX + '/statistics?start=2026-10-01&end=2026-10-01').json()
    assert result['daily'] == [{'date': '2026-10-01', 'completed': 0, 'created': 0, 'focus_seconds': 0}]
    assert result['previous']['start'] == result['previous']['end'] == '2026-09-30'
    assert result['completed'] == []
    assert client.get(PREFIX + '/statistics?start=2026-10-02&end=2026-10-01').status_code == 422
    assert client.get(PREFIX + '/statistics?start=2025-01-01&end=2026-10-01').status_code == 422
    task = status(client, create(client, '末日边界'), 'done')
    with tenant_session(client.user_id) as db:
        date_completions(db, task['id'], ['2026-10-01T16:00:00'])
    result = client.get(PREFIX + '/statistics?start=2026-10-01&end=2026-10-01').json()
    assert result['summary']['completed_tasks'] == 0
    result = client.get(PREFIX + '/statistics?start=2026-10-02&end=2026-10-02').json()
    assert result['summary']['completed_tasks'] == 1
