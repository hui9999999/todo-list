import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from app.agent import execute_agent
from app.advanced_models import ProviderConnection
from app.common import tenant_session
from app.config import settings
from test_p1_p4 import PREFIX, connection, run_message
from test_ai_task_operations import json_stream


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())


def flash_connection(client):
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {
            'deepseek-flash': {'chat': True, 'tools': False, 'thinking': 'toggle'},
        }
    assert client.put(PREFIX + '/model-preferences', json={
        'connection_id': conn['id'], 'model': 'deepseek-flash', 'thinking': 'auto',
    }).status_code == 200


@pytest.mark.parametrize('plain_answer', [False, True])
def test_flash_learning_question_returns_answer_without_forced_json(accounts, monkeypatch, plain_answer):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    task = client.post(PREFIX + '/tasks', json={'title': '背面试题', 'scope': 'study'}).json()
    answer = '先理解知识点，再合上书复述；把面试题拆成小组，隔天回忆复习。'
    def respond(c, payload):
        assert 'JSON' in payload['messages'][0]['content']
        assert 'tools' not in payload
        if 'response_format' in payload:
            # Reproduced provider behavior: a successful stop with whitespace only.
            yield {'choices': [{'delta': {'content': ' ' * 248}, 'finish_reason': 'stop'}]}
        elif plain_answer:
            yield {'choices': [{'delta': {'content': answer[:5]}}]}
            yield {'choices': [{'delta': {'content': answer[5:]}, 'finish_reason': 'stop'}]}
        else:
            yield from json_stream({'answer': answer, 'actions': [], 'followups': ['你要背哪类面试题？']})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    chat, run, _ = run_message(client, '怎么背书啊')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed', info
    assert info['answer'] == answer and info['proposals'] == [] and info['error'] is None
    messages = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()['messages']
    assert messages[-1]['role'] == 'assistant' and messages[-1]['content'] == answer
    assert client.get(PREFIX + '/tasks').json()[0]['version'] == task['version']


@pytest.mark.parametrize('user_text,answer', [
    ('算了不说了', '好，那不聊这个了。有需要随时喊我。'),
    ('嗯', '嗯，先歇一会儿也好。'),
    ('今天好累', '辛苦了，先休息一下吧。'),
    ('教我背书', '先理解，再合上书主动回忆。'),
    ('不想背了', '那就先休息一会儿，晚点再看看。'),
    ('给我讲个笑话', '为什么书总是很冷静？因为它有很多页可以翻过去。'),
    ('thanks', '随时来找我。'),
])
def test_flash_casual_chat_without_question_words_returns_answer(accounts, monkeypatch, user_text, answer):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    task = client.post(PREFIX + '/tasks', json={'title': '背面试题', 'scope': 'study'}).json()
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: iter([
        {'choices': [{'delta': {'content': answer}, 'finish_reason': 'stop'}]},
    ]))
    chat, run, _ = run_message(client, user_text)
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed', info
    assert info['answer'] == answer and info['proposals'] == [] and info['error'] is None
    messages = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()['messages']
    assert messages[-1]['role'] == 'assistant' and messages[-1]['content'] == answer
    assert client.get(PREFIX + '/tasks').json()[0]['version'] == task['version']


@pytest.mark.parametrize('user_text', ['新建任务复习', '请帮我创建复习计划', '删除背面试题任务', '把任务标题修改成复习'])
def test_casual_chat_fallback_does_not_swallow_task_requests(user_text):
    from app.agent import parse_model_output
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        parse_model_output('好的，请核对这项任务。', user_text, allow_plain_chat=True)


@pytest.mark.parametrize('content', [
    '{"queries":[{"category":"trash","limit":50}]}',
    '我查一下。\n{"queries":[{"category":"trash","limit":50}]}',
    '我查一下。\n```json\n{"queries":[{"category":"trash","limit":50}]}\n```',
])
def test_query_only_content_is_validated_as_read_request(content):
    from app.agent import parse_model_output
    output=parse_model_output(content,'现在能看了吗',allow_plain_chat=True)
    assert len(output.queries)==1 and output.queries[0].category=='trash'
    assert output.queries[0].limit==50 and not output.actions and not output.exports
    assert '"queries"' not in output.answer


@pytest.mark.parametrize('suffix', [
    '{"queries":[{"category":"trash","user_id":"another"}]}',
    '{"queries":[{"category":"trash","limit":500}]}',
    '{"queries":[{"category":"passwords"}]}',
    '{"queries":[{"category":"trash"}],"actions":[{"kind":"create","fields":{"title":"不得创建"}}]}',
    '{"queries":[{"category":"trash"}',
])
def test_embedded_query_cannot_bypass_validation_or_add_writes(suffix):
    from app.agent import parse_model_output
    with pytest.raises(ValueError):
        parse_model_output('我查一下。\n'+suffix,'现在能看了吗',allow_plain_chat=True)


def test_query_inside_answer_is_not_streamed_as_chat_or_combined_with_writes():
    import json
    from app.agent import parse_model_output,json_answer_prefix
    content=json.dumps({'answer':'我查一下。\n{"queries":[{"category":"trash"}]}'},ensure_ascii=False)
    assert json_answer_prefix(content) is None
    assert parse_model_output(content).queries[0].category=='trash'
    unsafe=json.loads(content)
    unsafe['actions']=[{'kind':'create','fields':{'title':'不得创建'}}]
    with pytest.raises(ValueError):parse_model_output(json.dumps(unsafe))


@pytest.mark.parametrize('answer',[
    '查到了，垃圾站里有两项任务，当前状态为已取消。',
    '垃圾站记录：已删除的学习计划；原状态为待办。',
    'The trash contains a task that has been deleted.',
])
def test_read_only_status_descriptions_are_not_claimed_writes(answer):
    from app.agent import parse_model_output
    output=parse_model_output(answer,'垃圾站里有什么',allow_plain_chat=True)
    assert output.answer==answer and not output.actions


@pytest.mark.parametrize('answer',['已经帮你删除任务。','好的，我已经取消了任务。','I have deleted the task.'])
def test_plain_chat_still_rejects_assistant_claims_of_task_changes(answer):
    from app.agent import parse_model_output
    with pytest.raises(ValueError):parse_model_output(answer,'垃圾站里有什么',allow_plain_chat=True)


def test_flash_create_still_requires_preview_confirmation(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    def respond(c, payload):
        assert 'response_format' not in payload
        yield from json_stream({'answer': '请核对这项任务。', 'actions': [{'kind': 'create', 'fields': {'title': '复习面试题', 'scope': 'study'}}]})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    _, run, _ = run_message(client, '新建学习任务复习面试题')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'awaiting_confirmation'
    assert client.get(PREFIX + '/tasks').json() == []
    proposal = info['proposals'][0]
    assert client.post(PREFIX + '/action-proposals/' + proposal['id'] + '/confirm', json={'version': proposal['version']}).status_code == 200
    assert client.get(PREFIX + '/tasks').json()[0]['title'] == '复习面试题'


@pytest.mark.parametrize('tools_enabled', [False, True])
@pytest.mark.parametrize('deadline_form', ['both', 'date_only'])
@pytest.mark.parametrize('clarified', [False, True])
def test_duplicate_tasks_with_matching_date_and_time_require_confirmation(accounts, monkeypatch, tools_enabled, deadline_form, clarified):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    import app.agent as agent
    from test_p1_p4 import output_stream
    client = accounts(); flash_connection(client)
    if tools_enabled:
        with tenant_session(client.user_id) as db:
            conn = db.scalar(select(ProviderConnection).where(ProviderConnection.user_id == client.user_id))
            conn.capabilities = {'deepseek-flash': {'chat': True, 'tools': True, 'thinking': 'toggle'}}
    originals = [client.post(PREFIX + '/tasks', json={'title': title, 'scope': 'study'}).json()
                 for title in ['背面试题', '构思简历']]
    tomorrow = (datetime.now(ZoneInfo('Asia/Shanghai')).date() + timedelta(days=1)).isoformat()
    due_at = tomorrow + 'T23:59:00+08:00'
    output = {'answer': '请确认新建两个同名学习任务，截止明天23:59。', 'actions': [
        {'kind': 'create', 'fields': {'title': task['title'], 'scope': 'study',
         'due_date': tomorrow, 'due_at': due_at, 'due_timezone': 'Asia/Shanghai'}} for task in originals
    ]}
    if deadline_form == 'date_only':
        for action in output['actions']:
            action['fields'].pop('due_at')
            action['fields'].pop('due_timezone')
    transport = output_stream if tools_enabled else json_stream
    request = '新建两个同名任务，截止设为明天23:59'
    if clarified:
        monkeypatch.setattr(agent, 'stream_chat', lambda c,p: transport({'answer': '请选择处理方式', 'question': '是否新建两个同名任务？'}))
        _, run, _ = run_message(client, '帮我把这两个任务改成每日任务吧')
        execute_agent(client.user_id, run['id'])
        assert client.get(PREFIX + '/agent-runs/' + run['id']).json()['status'] == 'awaiting_clarification'
        assert client.post(PREFIX + '/agent-runs/' + run['id'] + '/clarifications', json={'answer': request}).status_code == 200
    else:
        _, run, _ = run_message(client, request)
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: transport(output))
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'awaiting_confirmation', info
    assert len(client.get(PREFIX + '/tasks').json()) == 2
    proposal = info['proposals'][0]
    assert len(proposal['actions']) == 2
    assert all(action['fields']['due_date'] is None for action in proposal['actions'])
    assert all(action['fields']['due_at'] == due_at for action in proposal['actions'])
    assert client.post(PREFIX + '/action-proposals/' + proposal['id'] + '/confirm', json={'version': proposal['version']}).status_code == 200
    tasks = client.get(PREFIX + '/tasks').json()
    assert len(tasks) == 4
    created = [task for task in tasks if task['id'] not in {original['id'] for original in originals}]
    assert {task['title'] for task in created} == {'背面试题', '构思简历'}
    assert all(task['scope'] == 'study' and task['due_date'] is None and datetime.fromisoformat(task['due_at']) == datetime.fromisoformat(due_at) for task in created)
    assert all(next(task for task in tasks if task['id'] == original['id'])['version'] == original['version'] for original in originals)


@pytest.mark.parametrize('fields', [
    {'due_date': '2026-10-10', 'due_at': '2026-10-09T23:59:00+08:00', 'due_timezone': 'Asia/Shanghai'},
    {'due_date': '2026-10-08', 'due_at': '2026-10-08T16:00:00+00:00', 'due_timezone': 'Asia/Shanghai'},
    {'due_date': '2026-10-09', 'due_at': '2026-10-09T23:59:00', 'due_timezone': 'Asia/Shanghai'},
    {'due_date': '2026-10-09', 'due_at': '2026-10-09T23:59:00+08:00'},
    {'due_date': '2026-10-09', 'due_at': '2026-10-09T23:59:00+08:00', 'due_timezone': 'Invalid/Zone'},
    {'due_date': '2026-10-09', 'due_at': 'not a time', 'due_timezone': 'Asia/Shanghai'},
])
def test_conflicting_or_invalid_deadline_fields_are_not_repaired(fields):
    import json
    from app.agent import parse_model_output
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        parse_model_output(json.dumps({'answer': '创建预览', 'actions': [
            {'kind': 'create', 'fields': {'title': '复习', **fields}},
        ]}), '新建任务复习')


@pytest.mark.parametrize('kind', ['create', 'update'])
def test_redundant_date_uses_named_timezone_and_preserves_precise_time(kind):
    import json
    from datetime import datetime
    from app.agent import parse_model_output
    action = {'kind': kind, 'fields': {'title': '复习', 'due_date': '2026-10-09',
        'due_at': '2026-10-08T16:00:00+00:00', 'due_timezone': 'Asia/Shanghai'}}
    if kind == 'update':
        action.update(task_id='existing-task', version=7)
    output = parse_model_output(json.dumps({'answer': '请确认', 'actions': [action]}))
    fields = output.actions[0].fields
    assert fields.due_date is None and 'due_date' not in fields.model_fields_set
    assert fields.due_at == datetime.fromisoformat('2026-10-08T16:00:00+00:00')
    assert fields.due_timezone == 'Asia/Shanghai'
    if kind == 'update':
        assert output.actions[0].task_id == 'existing-task' and output.actions[0].version == 7


@pytest.mark.parametrize('user_text', [
    '截止明天', '不要设置截止明天23:59', 'A截止明天23:59，B截止后天12:00',
    '截止设为明天25:99', '明天23:59开始',
])
def test_missing_ambiguous_or_negated_exact_deadline_is_not_inferred(user_text):
    from datetime import date
    from app.agent import with_explicit_deadline
    from app.ai_schemas import AgentOutput
    output = AgentOutput.model_validate({'answer': '请确认', 'actions': [{'kind': 'create',
        'fields': {'title': '复习', 'due_date': '2026-10-09'}}]})
    result = with_explicit_deadline(output, user_text, date(2026,10,8), 'Asia/Shanghai')
    assert result == output


def test_explicit_deadline_does_not_overwrite_other_date_or_precise_time():
    from datetime import date
    from app.agent import with_explicit_deadline
    from app.ai_schemas import AgentOutput
    output = AgentOutput.model_validate({'answer': '请确认', 'actions': [
        {'kind': 'create', 'fields': {'title': '复习', 'due_date': '2026-10-10'}},
        {'kind': 'create', 'fields': {'title': '汇报', 'due_at': '2026-10-09T18:00:00+08:00', 'due_timezone': 'Asia/Shanghai'}},
    ]})
    assert with_explicit_deadline(output, '截止设为明天23:59', date(2026,10,8), 'Asia/Shanghai') == output


@pytest.mark.parametrize('invalid', ['blank', 'truncated', 'plain', 'stale', 'foreign'])
def test_flash_invalid_and_unauthorized_operations_remain_blocked(accounts, monkeypatch, invalid):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    owner = accounts() if invalid == 'foreign' else client
    task = owner.post(PREFIX + '/tasks', json={'title': '保留的任务'}).json()
    def respond(c, payload):
        assert 'response_format' not in payload
        if invalid in ('blank', 'truncated', 'plain'):
            content = {'blank': ' ' * 248, 'truncated': '{"answer":"预览"', 'plain': '已帮你删除任务'}[invalid]
            yield {'choices': [{'delta': {'content': content}, 'finish_reason': 'stop'}]}
        else:
            yield from json_stream({'answer': '删除预览', 'actions': [{'kind': 'trash', 'task_id': task['id'], 'version': task['version'] + (1 if invalid == 'stale' else 0)}]})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    _, run, _ = run_message(client, '删除保留的任务')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'failed' and info['proposals'] == []
    assert owner.get(PREFIX + '/tasks').json()[0]['version'] == task['version']
    if invalid == 'blank':
        assert '未返回回答' in info['error']


@pytest.mark.parametrize('content', ['{"answer":"截断"', '{"answer":"回答","actions":[{"kind":"trash"}]}', '```json\n{"answer":"截断"\n```', '已经帮你删除了任务'])
def test_read_only_question_does_not_bypass_invalid_actions_or_claim_changes(accounts, monkeypatch, content):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    task = client.post(PREFIX + '/tasks', json={'title': '背面试题'}).json()
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: iter([{'choices':[{'delta':{'content':content},'finish_reason':'stop'}]}]))
    _,run,_=run_message(client,'怎么背书啊')
    execute_agent(client.user_id,run['id'])
    info=client.get(PREFIX+'/agent-runs/'+run['id']).json()
    assert info['status']=='failed' and info['proposals']==[]
    assert client.get(PREFIX+'/tasks').json()[0]['version']==task['version']


def streamed_deltas(client, run_id):
    from app.advanced_models import RunEvent
    with tenant_session(client.user_id) as db:
        return list(db.scalars(select(RunEvent).where(
            RunEvent.user_id == client.user_id, RunEvent.run_id == run_id,
            RunEvent.kind == 'answer_delta').order_by(RunEvent.sequence)))


def chunked_stream(chunks):
    def respond(c, payload):
        for index, chunk in enumerate(chunks):
            yield {'choices': [{'delta': {'content': chunk},
                                'finish_reason': 'stop' if index == len(chunks) - 1 else None}]}
        yield {'choices': [], 'usage': {'prompt_tokens': 10, 'completion_tokens': 10}}
    return respond


def test_plain_chat_streams_answer_in_multiple_deltas(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    answer = '这是第一段流式回答的内容，用于验证增量推送确实按小段到达客户端，而不是等全部生成完才展示。' * 2
    chunks = [answer[i:i + 20] for i in range(0, len(answer), 20)]
    monkeypatch.setattr(agent, 'stream_chat', chunked_stream(chunks))
    _, run, _ = run_message(client, '随口聊聊今天的状态')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed' and info['answer'] == answer
    deltas = streamed_deltas(client, run['id'])
    assert len(deltas) >= 2, '纯文本回答应按小段增量推送'
    assert ''.join(d.payload['text'] for d in deltas) == answer


def test_json_envelope_streams_decoded_answer_without_structure(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); flash_connection(client)
    answer = '小狒按你的关注主题整理好了这条较长的回答，用于验证信封内的文本可以边生成边安全解码。' * 2
    body = __import__('json').dumps({'answer': answer, 'followups': ['还需要我做什么吗？']}, ensure_ascii=False)
    monkeypatch.setattr(agent, 'stream_chat', chunked_stream([body[i:i + 16] for i in range(0, len(body), 16)]))
    _, run, _ = run_message(client, '今天有什么值得关注的')
    execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed' and info['answer'] == answer
    deltas = streamed_deltas(client, run['id'])
    assert deltas, '信封回答应在生成过程中增量解码'
    assert ''.join(d.payload['text'] for d in deltas) == answer
    assert all('{' not in d.payload['text'] and '"actions"' not in d.payload['text'] and 'followups' not in d.payload['text']
               for d in deltas), '任何 JSON 结构字段都不能流出到界面'
