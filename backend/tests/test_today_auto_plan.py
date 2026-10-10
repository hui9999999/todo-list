from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.agent import prepare_proposal
from app.ai_schemas import Action
from app.common import tenant_session
from app.models import User
from app.schemas import TaskFields

PREFIX = '/api/v1'
NOW = datetime(2026, 10, 2, 1, 0, tzinfo=timezone.utc)


def plans(client, day, task_id=None):
    rows = client.get(PREFIX + '/daily-plans?plan_date=' + str(day)).json()
    return [row for row in rows if row['task_id'] == task_id] if task_id else rows


def create(client, **fields):
    response = client.post(PREFIX + '/tasks', json={'title': '今日安排测试', **fields})
    assert response.status_code == 201, response.text
    return response.json()


def edit(client, task, **fields):
    body = {key: task[key] for key in TaskFields.model_fields}
    response = client.put(PREFIX + '/tasks/' + task['id'], json={**body, **fields, 'version': task['version']})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('zone_name', ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati'])
def test_deadline_boundary_uses_account_day_and_creation_is_atomic(accounts, monkeypatch, zone_name):
    import app.tasks as tasks
    monkeypatch.setattr(tasks, 'utcnow', lambda: NOW)
    client = accounts()
    with tenant_session(client.user_id) as db:
        db.get(User, client.user_id).timezone = zone_name
    zone = ZoneInfo(zone_name)
    day = NOW.astimezone(zone).date()
    cases = [
        ({}, True),
        ({'due_date': str(day)}, True),
        ({'due_date': str(day - timedelta(days=1))}, True),
        ({'due_at': datetime.combine(day, time(23, 59), zone).isoformat(), 'due_timezone': zone_name}, True),
        ({'due_at': datetime.combine(day, time(23, 59, 59), zone).isoformat(), 'due_timezone': zone_name}, True),
        ({'due_at': datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc).isoformat(), 'due_timezone': 'UTC'}, False),
        ({'due_date': str(day + timedelta(days=1))}, False),
        ({'due_date': None, 'due_at': None}, False),
    ]
    for fields, expected in cases:
        task = create(client, **fields)
        assert len(plans(client, day, task['id'])) == int(expected)
        assert task['version'] == 1
    other = accounts()
    assert plans(other, day) == []
    bad = client.post(PREFIX + '/tasks', json={'title': '不能留下安排', 'parent_id': 'nonexistent-parent'})
    assert bad.status_code == 404
    assert len(client.get(PREFIX + '/tasks').json()) == len(cases)
    assert len(plans(client, day)) == sum(expected for _, expected in cases)


def test_deadline_changes_add_once_and_manual_removal_survives_unrelated_edits(accounts, monkeypatch):
    import app.tasks as tasks
    monkeypatch.setattr(tasks, 'utcnow', lambda: NOW)
    client = accounts()
    day = NOW.astimezone(ZoneInfo('Asia/Shanghai')).date()
    task = create(client, due_date=str(day + timedelta(days=1)))
    assert plans(client, day, task['id']) == []
    task = edit(client, task, due_date=str(day))
    first = plans(client, day, task['id'])
    assert len(first) == 1
    for _ in range(2):
        assert client.post(PREFIX + '/daily-plans', json={'task_id': task['id'], 'plan_date': str(day)}).status_code == 200
    assert plans(client, day, task['id']) == first
    assert client.delete(PREFIX + '/daily-plans/' + first[0]['id']).status_code == 200
    task = edit(client, task, title='改名称不重新加入', notes='保留手动移出的选择')
    assert plans(client, day, task['id']) == []
    task = edit(client, task, due_date=None, due_at=str(day) + 'T20:00:00+08:00', due_timezone='Asia/Shanghai')
    assert len(plans(client, day, task['id'])) == 1
    task = edit(client, task, due_at=str(day) + 'T21:00:00+08:00')
    assert len(plans(client, day, task['id'])) == 1
    # A later deadline does not erase a plan the user already has for today.
    task = edit(client, task, due_date=str(day + timedelta(days=2)), due_at=None, due_timezone=None)
    assert len(plans(client, day, task['id'])) == 1


def test_ai_confirmation_and_undo_include_automatic_plans(accounts, monkeypatch):
    import app.tasks as tasks
    monkeypatch.setattr(tasks, 'utcnow', lambda: NOW)
    client = accounts()
    day = NOW.astimezone(ZoneInfo('Asia/Shanghai')).date()

    def proposal(actions):
        with tenant_session(client.user_id) as db:
            row = prepare_proposal(db, db.get(User, client.user_id), actions, '今日安排测试')
            return row.id

    identifier = proposal([Action.model_validate({'kind': 'create', 'fields': {'title': 'AI 创建今日任务'}})])
    assert plans(client, day) == []
    response = client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1})
    assert response.status_code == 200, response.text
    created_id = response.json()['result'][0]['task_id']
    assert len(plans(client, day, created_id)) == 1
    assert client.post(PREFIX + '/actions/' + identifier + '/undo').status_code == 200
    assert plans(client, day, created_id) == []

    for original_today in [False, True]:
        task = create(client, due_date=str(day if original_today else day + timedelta(days=1)))
        for plan in plans(client, day, task['id']):
            assert client.delete(PREFIX + '/daily-plans/' + plan['id']).status_code == 200
        target = day + timedelta(days=1) if original_today else day
        identifier = proposal([Action.model_validate({'kind': 'update', 'task_id': task['id'], 'version': task['version'], 'fields': {'title': task['title'], 'due_date': str(target)}})])
        response = client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1})
        assert response.status_code == 200, response.text
        assert len(plans(client, day, task['id'])) == int(not original_today)
        assert client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1}).status_code == 200
        assert client.post(PREFIX + '/actions/' + identifier + '/undo').status_code == 200
        assert plans(client, day, task['id']) == []
        assert client.get(PREFIX + '/tasks/' + task['id']).json()['due_date'] == task['due_date']
