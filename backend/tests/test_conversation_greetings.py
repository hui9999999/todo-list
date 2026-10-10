import uuid
from sqlalchemy import select, func
from cryptography.fernet import Fernet
from app.common import tenant_session
from app.config import settings
from app.advanced_models import Conversation, Message, AgentRun, UsageEvent, Job
from app.models import Task
from app.persona import conversation_greeting


def counts(client):
    with tenant_session(client.user_id) as db:
        return [db.scalar(select(func.count()).select_from(model).where(model.user_id==client.user_id))
            for model in (AgentRun, UsageEvent, Job, Task)]


def test_new_chat_has_one_saved_opening_and_uses_no_model_or_tasks(accounts):
    client=accounts()
    before=counts(client)
    chat=client.post('/api/v1/conversations').json()
    assert chat['title']=='新对话'
    first=client.get('/api/v1/conversations/'+chat['id']+'/messages').json()
    second=client.get('/api/v1/conversations/'+chat['id']+'/messages').json()
    assert first==second
    assert first['runs']==[] and len(first['messages'])==1
    message=first['messages'][0]
    assert message['role']=='assistant' and 10<len(message['content'])<100
    assert message['attachments']==[]
    assert counts(client)==before


def test_new_chats_avoid_repeating_previous_opening(accounts,monkeypatch):
    import app.persona as persona
    monkeypatch.setattr(persona,'choice',lambda options:options[0])
    client=accounts()
    last=''
    for _ in range(4):
        chat=client.post('/api/v1/conversations').json()
        greeting=client.get('/api/v1/conversations/'+chat['id']+'/messages').json()['messages'][0]['content']
        assert greeting!=last
        last=greeting


def test_old_chats_do_not_gain_openings_and_other_users_cannot_read_them(accounts):
    client,other=accounts(),accounts()
    with tenant_session(client.user_id) as db:
        legacy=Conversation(user_id=client.user_id)
        db.add(legacy);db.flush();legacy_id=legacy.id
    assert client.get('/api/v1/conversations/'+legacy_id+'/messages').json()=={'messages':[],'runs':[],'downloads':[]}
    chat=client.post('/api/v1/conversations').json()
    assert other.get('/api/v1/conversations/'+chat['id']+'/messages').status_code==404
    assert other.get('/api/v1/conversations').json()==[]
    assert client.delete('/api/v1/conversations/'+chat['id']).status_code==200
    assert client.get('/api/v1/conversations/'+chat['id']+'/messages').status_code==404


def test_short_reply_sees_the_opening_in_model_context(accounts,monkeypatch):
    import app.agent as agent
    from test_chat_json_format import flash_connection
    monkeypatch.setattr(settings(),'credential_master_key',Fernet.generate_key().decode())
    client=accounts();flash_connection(client)
    chat=client.post('/api/v1/conversations').json()
    greeting=client.get('/api/v1/conversations/'+chat['id']+'/messages').json()['messages'][0]['content']
    def respond(connection,payload):
        assert payload['messages'][-2]=={'role':'assistant','content':greeting}
        assert payload['messages'][-1]=={'role':'user','content':'？？'}
        yield {'choices':[{'delta':{'content':'我是在打招呼呀，也可以随便聊聊。'},'finish_reason':'stop'}]}
    monkeypatch.setattr(agent,'stream_chat',respond)
    run=client.post('/api/v1/conversations/'+chat['id']+'/messages',json={'content':'？？','idempotency_key':str(uuid.uuid4())}).json()
    agent.execute_agent(client.user_id,run['id'])
    result=client.get('/api/v1/agent-runs/'+run['id']).json()
    assert result['status']=='completed' and result['proposals']==[]
    history=client.get('/api/v1/conversations/'+chat['id']+'/messages').json()['messages']
    assert [message['role'] for message in history]==['assistant','user','assistant']
    assert history[0]['content']==greeting
    assert client.get('/api/v1/tasks').json()==[]


def test_greeting_pool_is_short_and_has_no_private_task_facts():
    for _ in range(30):
        text=conversation_greeting()
        assert len(text)<100 and '\n' not in text
        assert not any(word in text for word in ('截止','未完成','今天有','我已经','你的任务'))
