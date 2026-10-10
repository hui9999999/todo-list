import json
import pytest
from cryptography.fernet import Fernet
from app.agent import execute_agent, prepare_proposal
from app.ai_schemas import Action
from app.common import tenant_session
from app.config import settings
from app.models import User
from app.advanced_models import ProviderConnection
from test_p1_p4 import PREFIX, connection, run_message, output_stream


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())


def json_stream(output):
    content = json.dumps(output, ensure_ascii=False)
    yield {'choices': [{'delta': {'content': content[:12]}}]}
    yield {'choices': [{'delta': {'content': content[12:]}, 'finish_reason': 'stop'}]}
    yield {'choices': [], 'usage': {'prompt_tokens': 20, 'completion_tokens': 20}}


@pytest.mark.parametrize('tools_enabled', [True, False])
def test_ai_create_update_delete_confirmation_and_undo(accounts, monkeypatch, tools_enabled):
    import app.agent as agent
    client = accounts()
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': tools_enabled}}
    actions = [{'kind': 'create', 'fields': {'title': '买牛奶', 'scope': 'life', 'notes': '保留这条备注', 'estimated_minutes': 15}}]
    def respond(c, payload):
        if not tools_enabled:
            assert 'tools' not in payload
            assert payload['response_format'] == {'type': 'json_object'}
            assert 'JSON' in payload['messages'][0]['content']
        yield from (output_stream if tools_enabled else json_stream)({'answer': '请核对任务操作。', 'actions': actions})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    def propose(message):
        _, run, _ = run_message(client, message)
        execute_agent(client.user_id, run['id'])
        info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
        assert info['status'] == 'awaiting_confirmation', info
        assert info['answer'] == '请核对任务操作。'
        events = client.get(PREFIX + '/agent-runs/' + run['id'] + '/events').text
        assert '\\"actions\\"' not in events  # Never stream raw model JSON to the chat.
        return info['proposals'][0]
    def confirm(proposal):
        response = client.post(PREFIX + '/action-proposals/' + proposal['id'] + '/confirm', json={'version': proposal['version']})
        assert response.status_code == 200, response.text
    creation = propose('创建生活任务买牛奶，备注保留这条备注，预计15分钟')
    assert client.get(PREFIX + '/tasks').json() == []
    assert creation['actions'][0]['fields']['due_at']
    confirm(creation)
    original = client.get(PREFIX + '/tasks').json()[0]
    actions[:] = [{'kind': 'update', 'task_id': original['id'], 'version': original['version'], 'fields': {'title': '买牛奶', 'priority': 'high'}}]
    update = propose('将买牛奶的优先级改为高')
    assert client.get(PREFIX + '/tasks').json()[0]['priority'] == 'mid'
    confirm(update)
    changed = client.get(PREFIX + '/tasks').json()[0]
    for key in ('notes', 'scope', 'due_at', 'due_timezone', 'estimated_minutes'):
        assert changed[key] == original[key]
    assert changed['priority'] == 'high'
    actions[:] = [{'kind': 'trash', 'task_id': changed['id'], 'version': changed['version']}]
    deletion = propose('删除任务买牛奶')
    assert len(client.get(PREFIX + '/tasks').json()) == 1
    confirm(deletion)
    assert client.get(PREFIX + '/tasks').json() == []
    assert client.get(PREFIX + '/tasks?trash=true').json()[0]['id'] == original['id']
    assert client.post(PREFIX + '/actions/' + deletion['id'] + '/undo').status_code == 200
    assert client.get(PREFIX + '/tasks').json()[0]['priority'] == 'high'


@pytest.mark.parametrize('invalid', ['plain', 'truncated', 'foreign'])
def test_json_mode_rejects_invalid_or_foreign_operations(accounts, monkeypatch, invalid):
    import app.agent as agent
    client = accounts()
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': False}}
    other = accounts()
    target = other.post(PREFIX + '/tasks', json={'title': '别人的任务'}).json()
    def respond(c, payload):
        if invalid == 'foreign':
            yield from json_stream({'answer': '删除', 'actions': [{'kind': 'trash', 'task_id': target['id'], 'version': 1}]})
        else:
            yield {'choices': [{'delta': {'content': '已帮你创建任务' if invalid == 'plain' else '{"answer":"预览"'}, 'finish_reason': 'stop'}]}
    monkeypatch.setattr(agent, 'stream_chat', respond)
    _, run, _ = run_message(client)
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'failed' and info['proposals'] == []
    assert client.get(PREFIX + '/tasks').json() == []
    assert len(other.get(PREFIX + '/tasks').json()) == 1


def test_ai_update_switches_deadline_without_losing_other_fields(accounts):
    client = accounts()
    task = client.post(PREFIX + '/tasks', json={'title': '汇报', 'notes': '备注'}).json()
    with tenant_session(client.user_id) as db:
        proposal = prepare_proposal(db, db.get(User, client.user_id), [Action.model_validate({
            'kind': 'update', 'task_id': task['id'], 'version': task['version'],
            'fields': {'title': '汇报', 'due_date': '2026-10-05'},
        })], '延期')
        identifier = proposal.id
    response = client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1})
    assert response.status_code == 200, response.text
    updated = client.get(PREFIX + '/tasks').json()[0]
    assert updated['due_date'] == '2026-10-05' and updated['due_at'] is None
    assert updated['notes'] == '备注'


def test_json_clarification_then_cancel_during_generation(accounts, monkeypatch):
    import app.agent as agent
    client = accounts()
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': False}}
    monkeypatch.setattr(agent, 'stream_chat', lambda c, p: json_stream({'answer': '请明确对象', 'question': '需要修改哪项任务？', 'options': ['工作任务', '生活任务']}))
    _, run, _ = run_message(client, '修改那项任务')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'awaiting_clarification' and info['proposals'] == []
    assert client.post(PREFIX + '/agent-runs/' + run['id'] + '/clarifications', json={'answer': '创建生活任务'}).status_code == 200
    def cancelled(c, p):
        yield {'choices': [{'delta': {'content': '{"answer":'}}]}
        assert client.post(PREFIX + '/agent-runs/' + run['id'] + '/cancel').status_code == 200
        yield from json_stream({'answer': '创建预览', 'actions': [{'kind': 'create', 'fields': {'title': '取消后不应创建'}}]})
    monkeypatch.setattr(agent, 'stream_chat', cancelled)
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'cancelled' and info['proposals'] == []
    assert client.get(PREFIX + '/tasks').json() == []


def test_transport_timeout_finishes_run_without_changes_and_allows_next_message(accounts, monkeypatch):
    from test_provider_stream_timeout import transport
    import app.agent as agent
    client = accounts()
    connection(client)
    task = client.post(PREFIX + '/tasks', json={'title': '任务测试'}).json()
    transport(monkeypatch, [b': heartbeat\n\n'] * 30, .025)
    _, run, _ = run_message(client, '删除任务测试的任务')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'failed' and info['proposals'] == []
    assert '超时' in info['error']
    events = client.get(PREFIX + '/agent-runs/' + run['id'] + '/events').text
    assert 'event: error' in events and '"status": "failed"' in events
    assert client.get(PREFIX + '/tasks').json()[0]['version'] == task['version']
    monkeypatch.setattr(agent, 'stream_chat', lambda c, p: output_stream({'answer': '请确认删除', 'actions': [
        {'kind': 'trash', 'task_id': task['id'], 'version': task['version']}]}))
    _, retry, _ = run_message(client, '删除任务测试的任务')
    execute_agent(client.user_id, retry['id'])
    assert client.get(PREFIX + '/agent-runs/' + retry['id']).json()['status'] == 'awaiting_confirmation'
    assert len(client.get(PREFIX + '/tasks').json()) == 1
