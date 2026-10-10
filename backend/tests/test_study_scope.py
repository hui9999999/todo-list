import json
import uuid
import pytest
from cryptography.fernet import Fernet
from app.agent import execute_agent
from app.common import tenant_session, today
from app.config import settings
from app.models import User
from app.advanced_models import ProviderConnection
from test_p1_p4 import PREFIX, connection, output_stream
from test_ai_task_operations import json_stream


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())


def test_study_tasks_history_statistics_and_backup_restore(accounts):
    client, restored = accounts(), accounts()
    project = client.post(PREFIX + '/projects', json={'title': '学习计划', 'scope': 'study'})
    assert project.status_code == 201, project.text
    response = client.post(PREFIX + '/tasks', json={'title': '学习线性代数', 'scope': 'study', 'project_id': project.json()['id']})
    assert response.status_code == 201, response.text
    task = response.json()
    assert task['scope'] == 'study' and task['due_at']
    response = client.put(PREFIX + '/tasks/' + task['id'], json={'title': task['title'], 'scope': 'study', 'status': 'done', 'project_id': task['project_id'], 'version': task['version']})
    assert response.status_code == 200, response.text
    assert client.post(PREFIX + '/tasks', json={'title': '学习线性代数相关工作', 'scope': 'work'}).status_code == 201
    history = client.get(PREFIX + '/history/search?q=线性代数&scope=study&semantic=false')
    assert history.status_code == 200, history.text
    assert history.json()['hits'] and all(hit['snapshot']['scope'] == 'study' for hit in history.json()['hits'])
    with tenant_session(client.user_id) as db:
        day = str(today(db.get(User, client.user_id)))
    metrics = client.get(PREFIX + f'/statistics?start={day}&end={day}').json()
    assert metrics['scopes'] == {'study': 1}
    assert metrics['completed'][0]['scope'] == 'study'
    backup = client.get(PREFIX + '/exports').json()
    preview = restored.post(PREFIX + '/imports/preview', json={'content': json.dumps(backup), 'scope': 'unassigned'})
    assert preview.status_code == 200, preview.text
    assert preview.json()['issues'] == []
    assert restored.post(PREFIX + '/imports/' + preview.json()['id'] + '/confirm').status_code == 200
    assert next(task for task in restored.get(PREFIX + '/tasks').json() if task['title'] == '学习线性代数')['scope'] == 'study'
    assert restored.get(PREFIX + '/projects').json()[0]['scope'] == 'study'


def test_study_import_default_recurrence_and_memory(accounts):
    client = accounts()
    preview = client.post(PREFIX + '/imports/preview', json={'content': json.dumps([{'id': 'legacy-study', 'text': '读书'}]), 'scope': 'study'})
    assert preview.status_code == 200 and preview.json()['issues'] == [], preview.text
    assert client.post(PREFIX + '/imports/' + preview.json()['id'] + '/confirm').status_code == 200
    assert client.get(PREFIX + '/tasks').json()[0]['scope'] == 'study'
    with tenant_session(client.user_id) as db:
        day = str(today(db.get(User, client.user_id)))
    rule = client.post(PREFIX + '/recurrences', json={'template': {'title': '每日背单词', 'scope': 'study'}, 'frequency': 'daily', 'start_date': day})
    assert rule.status_code == 201, rule.text
    assert rule.json()['template']['scope'] == 'study'
    assert any(task['title'] == '每日背单词' and task['scope'] == 'study' for task in client.get(PREFIX + '/tasks').json())
    memory = client.post(PREFIX + '/memories', json={'content': '每天学习英语', 'key': '学习目标', 'kind': 'goal', 'scope': 'study'})
    assert memory.status_code == 201 and memory.json()['scope'] == 'study', memory.text


@pytest.mark.parametrize('tools_enabled', [True, False])
def test_ai_creates_and_recategorizes_study_tasks(accounts, monkeypatch, tools_enabled):
    import app.agent as agent
    client = accounts()
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': tools_enabled}}
    old = client.post(PREFIX + '/tasks', json={'title': '读书笔记', 'scope': 'life', 'notes': '保留备注'}).json()
    conversation = client.post(PREFIX + '/conversations').json()
    def respond(c, payload):
        assert 'study=学习' in payload['messages'][0]['content']
        output = {'answer': '请确认学习分类的任务变更。', 'actions': [
            {'kind': 'create', 'fields': {'title': '复习英语单词', 'scope': 'study'}},
            {'kind': 'update', 'task_id': old['id'], 'version': old['version'], 'fields': {'title': old['title'], 'scope': 'study'}},
        ]}
        yield from (output_stream if tools_enabled else json_stream)(output)
    monkeypatch.setattr(agent, 'stream_chat', respond)
    response = client.post(PREFIX + '/conversations/' + conversation['id'] + '/messages', json={'content': '创建学习任务复习英语单词，把读书笔记也归为学习', 'idempotency_key': str(uuid.uuid4())})
    assert response.status_code == 202, response.text
    execute_agent(client.user_id, response.json()['id'])
    run = client.get(PREFIX + '/agent-runs/' + response.json()['id']).json()
    assert run['status'] == 'awaiting_confirmation', run
    assert client.get(PREFIX + '/tasks').json()[0]['scope'] == 'life'
    proposal = run['proposals'][0]
    assert client.post(PREFIX + '/action-proposals/' + proposal['id'] + '/confirm', json={'version': 1}).status_code == 200
    tasks = client.get(PREFIX + '/tasks').json()
    assert len(tasks) == 2 and all(task['scope'] == 'study' for task in tasks)
    assert next(task for task in tasks if task['id'] == old['id'])['notes'] == '保留备注'
