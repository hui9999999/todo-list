from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.agent import execute_agent
from app.advanced_models import ProviderConnection, RecurrenceInstance
from app.common import tenant_session, today
from app.models import User
from test_chat_json_format import encryption, flash_connection
from test_ai_task_operations import json_stream
from test_p1_p4 import PREFIX, output_stream, run_message


def recurrence_chat(client, monkeypatch, actions, tools=False):
    import app.agent as agent
    flash_connection(client)
    if tools:
        with tenant_session(client.user_id) as db:
            conn = db.scalar(select(ProviderConnection).where(ProviderConnection.user_id == client.user_id))
            conn.capabilities = {'deepseek-flash': {'chat': True, 'tools': True, 'thinking': 'toggle'}}
    def respond(connection, payload):
        assert '周期任务' in payload['messages'][0]['content']
        yield from (output_stream if tools else json_stream)({'answer': '请确认周期任务安排。', 'actions': actions})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    _, run, _ = run_message(client, '创建或转换这些每日周期任务')
    execute_agent(client.user_id, run['id'])
    return client.get(PREFIX + '/agent-runs/' + run['id']).json()


def local_day(client):
    with tenant_session(client.user_id) as db:
        return today(db.get(User, client.user_id))


def confirm(client, proposal):
    return client.post(PREFIX + '/action-proposals/' + proposal['id'] + '/confirm', json={'version': proposal['version']})


@pytest.mark.parametrize('frequency', ['daily', 'weekly', 'monthly'])
@pytest.mark.parametrize('tools', [False, True])
def test_ai_create_recurrence_previews_confirms_and_undoes(accounts, monkeypatch, frequency, tools):
    client = accounts()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'create', 'fields': {'title': '背面试题', 'scope': 'study'},
        'recurrence': {'frequency': frequency}}], tools)
    assert info['status'] == 'awaiting_confirmation', info
    proposal = info['proposals'][0]
    assert proposal['actions'][0]['recurrence']['start_date'] == str(local_day(client))
    assert client.get(PREFIX + '/recurrences').json() == []
    assert client.get(PREFIX + '/tasks').json() == []
    response = confirm(client, proposal)
    assert response.status_code == 200, response.text
    rules = client.get(PREFIX + '/recurrences').json()
    tasks = client.get(PREFIX + '/tasks').json()
    assert len(rules) == len(tasks) == 1
    assert rules[0]['frequency'] == frequency and rules[0]['template']['scope'] == 'study'
    assert tasks[0]['due_date'] == str(local_day(client))
    assert confirm(client, proposal).status_code == 200
    assert len(client.get(PREFIX + '/tasks').json()) == 1
    assert client.post(PREFIX + '/actions/' + proposal['id'] + '/undo').status_code == 200
    assert not client.get(PREFIX + '/recurrences').json()[0]['enabled']
    assert client.get(PREFIX + '/tasks').json() == []


@pytest.mark.parametrize('frequency', ['daily', 'weekly', 'monthly'])
def test_two_existing_tasks_become_recurring_without_duplicates(accounts, monkeypatch, frequency):
    client = accounts()
    tasks = [client.post(PREFIX + '/tasks', json={'title': title, 'scope': 'study', 'notes': '原备注', 'priority': 'high'}).json()
             for title in ['构思简历', '背面试题']]
    actions = [{'kind': 'update', 'task_id': task['id'], 'version': task['version'],
                'recurrence': {'frequency': frequency}} for task in tasks]
    info = recurrence_chat(client, monkeypatch, actions)
    assert info['status'] == 'awaiting_confirmation', info
    proposal = info['proposals'][0]
    assert len(proposal['actions']) == 2
    assert client.get(PREFIX + '/recurrences').json() == []
    assert confirm(client, proposal).status_code == 200
    current = client.get(PREFIX + '/tasks').json()
    assert {task['id'] for task in current} == {task['id'] for task in tasks}
    assert len(client.get(PREFIX + '/recurrences').json()) == 2
    for task in current:
        old = next(original for original in tasks if original['id'] == task['id'])
        assert all(task[key] == old[key] for key in ['title', 'scope', 'notes', 'priority', 'due_at'])
    with tenant_session(client.user_id) as db:
        assert len(list(db.scalars(select(RecurrenceInstance).where(RecurrenceInstance.user_id == client.user_id)))) == 2
    assert client.post(PREFIX + '/actions/' + proposal['id'] + '/undo').status_code == 200
    assert all(not rule['enabled'] for rule in client.get(PREFIX + '/recurrences').json())
    assert {task['id'] for task in client.get(PREFIX + '/tasks').json()} == {task['id'] for task in tasks}


def test_future_recurrence_undo_has_no_required_task_id(accounts, monkeypatch):
    client = accounts()
    future = str(local_day(client) + timedelta(days=1))
    info = recurrence_chat(client, monkeypatch, [{'kind': 'create', 'fields': {'title': '每天背单词', 'scope': 'study'},
        'recurrence': {'frequency': 'daily', 'start_date': future}}])
    assert info['status'] == 'awaiting_confirmation', info
    proposal = info['proposals'][0]
    assert confirm(client, proposal).status_code == 200
    assert client.get(PREFIX + '/tasks').json() == []
    assert client.post(PREFIX + '/actions/' + proposal['id'] + '/undo').status_code == 200
    assert not client.get(PREFIX + '/recurrences').json()[0]['enabled']


def test_conversion_conflict_and_foreign_task_remain_blocked(accounts, monkeypatch):
    client, other = accounts(), accounts()
    task = client.post(PREFIX + '/tasks', json={'title': '背面试题'}).json()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'update', 'task_id': task['id'], 'version': task['version'], 'recurrence': {'frequency': 'daily'}}])
    assert info['status'] == 'awaiting_confirmation', info
    assert client.put(PREFIX + '/tasks/' + task['id'], json={'title': '新版题目', 'version': task['version']}).status_code == 200
    assert confirm(client, info['proposals'][0]).status_code == 409
    assert client.get(PREFIX + '/recurrences').json() == []
    foreign = other.post(PREFIX + '/tasks', json={'title': '其他用户任务'}).json()
    failed = recurrence_chat(client, monkeypatch, [{'kind': 'update', 'task_id': foreign['id'], 'version': foreign['version'], 'recurrence': {'frequency': 'daily'}}])
    assert failed['status'] == 'failed' and failed['proposals'] == []
    assert other.get(PREFIX + '/recurrences').json() == []


def test_undo_stops_when_worker_has_generated_later_instances(accounts, monkeypatch):
    import app.experience as experience
    client = accounts()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'create', 'fields': {'title': '每日练习'}, 'recurrence': {'frequency': 'daily'}}])
    assert info['status'] == 'awaiting_confirmation', info
    proposal = info['proposals'][0]
    assert confirm(client, proposal).status_code == 200
    day = local_day(client)
    monkeypatch.setattr(experience, 'today', lambda user: day + timedelta(days=1))
    with tenant_session(client.user_id) as db:
        experience.materialize_recurrences(db, db.get(User, client.user_id))
    assert len(client.get(PREFIX + '/tasks').json()) == 2
    assert client.post(PREFIX + '/actions/' + proposal['id'] + '/undo').status_code == 409
    assert client.get(PREFIX + '/recurrences').json()[0]['enabled']


@pytest.mark.parametrize('invalid', [{'frequency': 'yearly'}, {'frequency': 'daily', 'interval': 0}, {'frequency': 'daily', 'interval': 366}, {'frequency': 'daily', 'mode': 'invalid'}])
def test_invalid_recurrence_does_not_change_tasks(accounts, monkeypatch, invalid):
    client = accounts()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'create', 'fields': {'title': '保留'}, 'recurrence': invalid}])
    assert info['status'] == 'failed' and info['proposals'] == []
    assert client.get(PREFIX + '/tasks').json() == []
    assert client.get(PREFIX + '/recurrences').json() == []


def test_conversion_cannot_add_second_enabled_rule(accounts, monkeypatch):
    client = accounts()
    task = client.post(PREFIX + '/tasks', json={'title': '每日背书'}).json()
    action = {'kind': 'update', 'task_id': task['id'], 'version': task['version'], 'recurrence': {'frequency': 'daily'}}
    info = recurrence_chat(client, monkeypatch, [action])
    assert confirm(client, info['proposals'][0]).status_code == 200
    action['version'] = client.get(PREFIX + '/tasks').json()[0]['version']
    failed = recurrence_chat(client, monkeypatch, [action])
    assert failed['status'] == 'failed' and failed['proposals'] == []
    assert len(client.get(PREFIX + '/recurrences').json()) == 1
    assert len(client.get(PREFIX + '/tasks').json()) == 1


@pytest.mark.parametrize('invalid_task', ['closed', 'child'])
def test_conversion_preserves_closed_tasks_and_children(accounts, monkeypatch, invalid_task):
    client = accounts()
    fields = {'title': '原任务'}
    if invalid_task == 'closed':
        fields['status'] = 'done'
    else:
        parent = client.post(PREFIX + '/tasks', json={'title': '父任务'}).json()
        fields['parent_id'] = parent['id']
    task = client.post(PREFIX + '/tasks', json=fields).json()
    failed = recurrence_chat(client, monkeypatch, [{'kind': 'update', 'task_id': task['id'], 'version': task['version'], 'recurrence': {'frequency': 'weekly'}}])
    assert failed['status'] == 'failed' and failed['proposals'] == []
    assert client.get(PREFIX + '/recurrences').json() == []
    assert next(item for item in client.get(PREFIX + '/tasks').json() if item['id'] == task['id'])['version'] == task['version']


def test_conversion_after_completion_generates_next_day(accounts, monkeypatch):
    import app.experience as experience
    client = accounts()
    task = client.post(PREFIX + '/tasks', json={'title': '背书'}).json()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'update', 'task_id': task['id'], 'version': task['version'], 'recurrence': {'frequency': 'daily', 'mode': 'after_completion'}}])
    assert confirm(client, info['proposals'][0]).status_code == 200
    rule = client.get(PREFIX + '/recurrences').json()[0]
    assert rule['next_date'] is None
    current = client.get(PREFIX + '/tasks').json()[0]
    assert client.put(PREFIX + '/tasks/' + task['id'], json={'title': '背书', 'status': 'done', 'version': current['version']}).status_code == 200
    day = local_day(client)
    monkeypatch.setattr(experience, 'today', lambda user: day + timedelta(days=1))
    with tenant_session(client.user_id) as db:
        experience.materialize_recurrences(db, db.get(User, client.user_id))
    tasks = client.get(PREFIX + '/tasks').json()
    assert len(tasks) == 2
    assert next(item for item in tasks if item['id'] != task['id'])['due_date'] == str(day + timedelta(days=1))


def test_purging_ai_recurrence_instance_clears_saved_preview(accounts, monkeypatch):
    client = accounts()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'create', 'fields': {'title': '删除敏感内容'}, 'recurrence': {'frequency': 'daily'}}])
    proposal = info['proposals'][0]
    assert confirm(client, proposal).status_code == 200
    task = client.get(PREFIX + '/tasks').json()[0]
    assert client.post(PREFIX + '/tasks/' + task['id'] + '/trash', json={'version': task['version']}).status_code == 200
    removed = client.get(PREFIX + '/tasks?trash=true').json()[0]
    assert client.post(PREFIX + '/tasks/' + task['id'] + '/purge', json={'version': removed['version']}).status_code == 200
    saved = client.get(PREFIX + '/action-proposals/' + proposal['id']).json()
    assert saved['state'] == 'expired' and saved['actions'] == [] and saved['result'] == []


def test_future_conversion_after_completion_respects_start_date(accounts, monkeypatch):
    import app.experience as experience
    client = accounts()
    day = local_day(client)
    start = day + timedelta(days=3)
    task = client.post(PREFIX + '/tasks', json={'title': '完成后再背'}).json()
    info = recurrence_chat(client, monkeypatch, [{'kind': 'update', 'task_id': task['id'], 'version': task['version'],
        'recurrence': {'frequency': 'daily', 'mode': 'after_completion', 'start_date': str(start)}}])
    assert confirm(client, info['proposals'][0]).status_code == 200
    assert client.get(PREFIX + '/recurrences').json()[0]['next_date'] is None
    current = client.get(PREFIX + '/tasks').json()[0]
    assert client.put(PREFIX + '/tasks/' + task['id'], json={'title': task['title'], 'status': 'done', 'version': current['version']}).status_code == 200
    for check_day in [day + timedelta(days=2), start]:
        monkeypatch.setattr(experience, 'today', lambda user: check_day)
        with tenant_session(client.user_id) as db:
            experience.materialize_recurrences(db, db.get(User, client.user_id))
        tasks = client.get(PREFIX + '/tasks').json()
        assert len(tasks) == (1 if check_day < start else 2)
    assert next(item for item in tasks if item['id'] != task['id'])['due_date'] == str(start)
