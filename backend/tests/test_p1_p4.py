import json
import uuid
from datetime import timedelta, date
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select, text
from app.config import settings
from app.common import tenant_session, preferences
from app.models import User, Task, utcnow
from app.advanced_models import ActionProposal, Memory, ForgetRequest, AgentRun, Job, FocusSession, ProviderConnection, UsageEvent, RecurrenceRule
from app.agent import prepare_proposal, execute_agent, reserve_usage
from app.ai_schemas import Action
from app.schemas import TaskFields

PREFIX='/api/v1'


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())


def task(client, title='客户汇报', **fields):
    response=client.post(PREFIX+'/tasks',json={'title':title,'scope':'work',**fields})
    assert response.status_code==201,response.text
    return response.json()


def connection(client, provider='deepseek'):
    response=client.post(PREFIX+'/provider-connections',json={'name':'test','provider':provider,'api_key':'test-key-never-export'})
    assert response.status_code==201,response.text
    row=response.json()
    with tenant_session(client.user_id) as db:
        obj=db.get(ProviderConnection,row['id'])
        assert obj.ciphertext!='test-key-never-export'
        obj.capabilities={'test-model':{'chat':True,'tools':True,'thinking':'toggle'}}
    assert client.put(PREFIX+'/model-preferences',json={'connection_id':row['id'],'model':'test-model','thinking':'auto'}).status_code==200
    return row


def run_message(client, text='买牛奶'):
    chat=client.post(PREFIX+'/conversations').json()
    key=str(uuid.uuid4())
    response=client.post(PREFIX+'/conversations/'+chat['id']+'/messages',json={'content':text,'idempotency_key':key})
    assert response.status_code==202,response.text
    return chat,response.json(),key


def output_stream(output):
    body=json.dumps(output,ensure_ascii=False)
    yield {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'respond','arguments':body[:len(body)//2]}}]}}]}
    yield {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'arguments':body[len(body)//2:]}}]},'finish_reason':'tool_calls'}]}
    yield {'choices':[],'usage':{'prompt_tokens':30,'completion_tokens':20}}


def test_agent_confirmation_idempotency_and_private_sse(accounts,monkeypatch):
    import app.agent as agent
    a,b=accounts(),accounts()
    connection(a)
    def friendly_assistant(c, payload):
        system = payload['messages'][0]['content']
        assert '你是小狒' in system and '不说教、不催促' in system
        assert '用户确认后系统执行；不得宣称已执行' in system
        yield from output_stream({'answer':'将创建买牛奶，请确认。','actions':[{'kind':'create','fields':{'title':'买牛奶','scope':'life'}}]})
    monkeypatch.setattr(agent,'stream_chat',friendly_assistant)
    chat,run,key=run_message(a)
    repeated=a.post(PREFIX+'/conversations/'+chat['id']+'/messages',json={'content':'买牛奶','idempotency_key':key})
    assert repeated.json()['id']==run['id']
    assert b.get(PREFIX+'/agent-runs/'+run['id']).status_code==404
    assert b.get(PREFIX+'/agent-runs/'+run['id']+'/events').status_code==404
    assert b.get(PREFIX+'/conversations/'+chat['id']+'/messages').status_code==404
    execute_agent(a.user_id,run['id'])
    info=a.get(PREFIX+'/agent-runs/'+run['id']).json()
    assert info['status']=='awaiting_confirmation',info
    assert a.get(PREFIX+'/tasks').json()==[]
    proposal=info['proposals'][0]
    assert b.post(PREFIX+'/action-proposals/'+proposal['id']+'/confirm',json={'version':1}).status_code==404
    path=PREFIX+'/action-proposals/'+proposal['id']+'/confirm'
    assert a.post(path,json={'version':1}).status_code==200
    assert a.post(path,json={'version':1}).status_code==200
    tasks=a.get(PREFIX+'/tasks').json()
    assert len(tasks)==1 and tasks[0]['title']=='买牛奶'
    events=a.get(PREFIX+'/agent-runs/'+run['id']+'/events').text
    assert 'event: proposal' in events and 'event: tool_result' in events
    resumed=a.get(PREFIX+'/agent-runs/'+run['id']+'/events?after=999').text
    assert 'event: proposal' not in resumed
    assert a.post(PREFIX+'/actions/'+proposal['id']+'/undo').status_code==200
    assert a.get(PREFIX+'/tasks').json()==[]
    exported=a.get(PREFIX+'/exports').text
    assert 'test-key-never-export' not in exported


def test_proposal_conflict_rolls_back_and_undo_checks_versions(accounts):
    a=accounts()
    t=task(a)
    with tenant_session(a.user_id) as db:
        user=db.get(User,a.user_id)
        p=prepare_proposal(db,user,[Action(kind='create',fields=TaskFields(title='new')),Action(kind='update',task_id=t['id'],version=t['version'],fields=TaskFields(title='修改'))],'reason')
        identifier=p.id
    assert a.put(PREFIX+'/tasks/'+t['id'],json={'title':'他人编辑','version':t['version']}).status_code==200
    result=a.post(PREFIX+'/action-proposals/'+identifier+'/confirm',json={'version':1})
    assert result.status_code==409
    assert len(a.get(PREFIX+'/tasks').json())==1


def test_clarification_and_cancel_mid_stream(accounts,monkeypatch):
    import app.agent as agent
    a=accounts(); connection(a)
    monkeypatch.setattr(agent,'stream_chat',lambda c,p:output_stream({'answer':'请明确对象','question':'选择哪一项？','options':['工作','生活']}))
    chat,run,key=run_message(a,'推迟一点')
    execute_agent(a.user_id,run['id'])
    assert a.get(PREFIX+'/agent-runs/'+run['id']).json()['status']=='awaiting_clarification'
    assert a.post(PREFIX+'/agent-runs/'+run['id']+'/clarifications',json={'answer':'工作'}).status_code==200
    def cancelled(c,p):
        yield {'choices':[{'delta':{'content':'第一部分'}}]}
        assert a.post(PREFIX+'/agent-runs/'+run['id']+'/cancel').status_code==200
        yield from output_stream({'answer':'已生成','actions':[{'kind':'create','fields':{'title':'不应创建'}}]})
    monkeypatch.setattr(agent,'stream_chat',cancelled)
    execute_agent(a.user_id,run['id'])
    assert a.get(PREFIX+'/agent-runs/'+run['id']).json()['status']=='cancelled'
    assert a.get(PREFIX+'/tasks').json()==[]


@pytest.mark.parametrize('provider',['deepseek','bailian'])
def test_adapter_mode_mapping_and_key_disable(accounts,monkeypatch,provider):
    import app.agent as agent
    a=accounts(); c=connection(a,provider)
    captured=[]
    def respond(conn,payload):
        captured.append(payload)
        yield from output_stream({'answer':'已读取','followups':['查看历史？']})
    monkeypatch.setattr(agent,'stream_chat',respond)
    _,run,_=run_message(a,'简单记录')
    execute_agent(a.user_id,run['id'])
    assert captured[0]['model']=='test-model'
    if provider=='deepseek':
        assert captured[0]['thinking']=={'type':'disabled'} and 'enable_thinking' not in captured[0]
    else:
        assert captured[0]['enable_thinking'] is False and 'thinking' not in captured[0]
    assert a.delete(PREFIX+'/provider-connections/'+c['id']).status_code==200
    assert 'test-key-never-export' not in a.get(PREFIX+'/provider-connections').text
    _,_,_=None,None,None


def test_memory_overlay_decay_forget_and_history_evidence(accounts):
    from app.memory import context_memories,memory_state,cleanup_forget
    a,b=accounts(),accounts()
    original=task(a,'旧客户汇报')
    assert a.put(PREFIX+'/tasks/'+original['id'],json={'title':'旧客户汇报','status':'done','version':1}).status_code==200
    assert a.put(PREFIX+'/tasks/'+original['id'],json={'title':'新标题','status':'todo','version':2}).status_code==200
    hits=a.get(PREFIX+'/history/search?q=客户汇报').json()
    assert any(h['title']=='旧客户汇报' and h['completed'] for h in hits['hits'])
    assert b.get(PREFIX+'/history/search?q=客户汇报').json()['hits']==[]
    base=a.post(PREFIX+'/memories',json={'content':'上午工作','key':'工作时段','scope':'work'}).json()
    temp=a.post(PREFIX+'/memories',json={'content':'出差期间下午工作','key':'工作时段','scope':'work','kind':'constraint','valid_to':(utcnow()+timedelta(days=1)).isoformat()}).json()
    with tenant_session(a.user_id) as db:
        assert context_memories(db,a.user_id,'work')[0]['id']==temp['id']
        row=db.get(Memory,temp['id']);row.valid_to=utcnow()-timedelta(days=1)
    with tenant_session(a.user_id) as db:
        assert context_memories(db,a.user_id,'work')[0]['id']==base['id']
        candidate=Memory(user_id=a.user_id,content='弱兴趣',key='兴趣',source_kind='confirmed',state='active',half_life_days=30,evidence_at=utcnow()-timedelta(days=100))
        db.add(candidate);db.flush()
        assert memory_state(candidate)[0]=='dormant'
    assert b.post(PREFIX+'/memories/'+base['id']+'/forget').status_code==404
    forget=a.post(PREFIX+'/memories/'+base['id']+'/forget').json()
    with tenant_session(a.user_id) as db:
        assert all(m['id']!=base['id'] for m in context_memories(db,a.user_id))
        assert db.get(Memory,base['id']).content==''
        cleanup_forget(db,a.user_id,forget['id'])
    assert a.get(PREFIX+'/forget-requests/'+forget['id']).json()['state']=='completed'
    assert a.get(PREFIX+'/history/search?q=客户汇报').json()['hits']


def settings_body(client,**changes):
    data=client.get(PREFIX+'/settings').json()
    allowed={'version','timezone','memory_enabled','followups_enabled','news_enabled','suggestions_enabled','notifications_enabled','weather_enabled','weather_city','theme','work_start','work_end','daily_capacity','recommendation_time','daily_call_limit','daily_token_limit'}
    return {**{k:v for k,v in data.items() if k in allowed},**changes}


def test_recommendation_accept_disabled_queue_and_budget(accounts):
    from app.recommendations import generate_recommendations
    from app.common import today
    a=accounts(); task(a, due_date=None, due_at=None)
    data=a.put(PREFIX+'/settings',json=settings_body(a,suggestions_enabled=True,daily_call_limit=1,daily_token_limit=100)).json()
    with tenant_session(a.user_id) as db:
        payload={'date':str(today(db.get(User,a.user_id))),'settings_version':data['version']}
    generate_recommendations(a.user_id,'suggestions',payload)
    items=a.get(PREFIX+'/recommendations').json()
    assert len(items)==1
    assert a.get(PREFIX+'/daily-plans?plan_date='+payload['date']).json()==[]
    path=PREFIX+'/recommendations/'+items[0]['id']+'/accept'
    assert a.post(path).status_code==200
    assert a.post(path).status_code==200
    assert len(a.get(PREFIX+'/daily-plans?plan_date='+payload['date']).json())==1
    assert a.put(PREFIX+'/settings',json=settings_body(a,suggestions_enabled=False)).status_code==200
    generate_recommendations(a.user_id,'suggestions',payload)
    assert a.post(PREFIX+'/recommendations/refresh?kind=suggestions').status_code==409
    c=connection(a)
    with tenant_session(a.user_id) as db:
        user=db.get(User,a.user_id);conn=db.get(ProviderConnection,c['id'])
        reserve_usage(db,user,conn,'test-model','fast','news',80)
    with pytest.raises(HTTPException):
        with tenant_session(a.user_id) as db:
            reserve_usage(db,db.get(User,a.user_id),db.get(ProviderConnection,c['id']),'test-model','fast','news',80)


def test_focus_calendar_recurrence_and_permanent_delete(accounts):
    from app.experience import recurrence_next,materialize_recurrences
    a,b=accounts(),accounts();t=task(a)
    focus=a.post(PREFIX+'/focus-sessions',json={'task_id':t['id'],'minutes':25}).json()
    assert b.post(PREFIX+'/focus-sessions/'+focus['id'],json={'version':1,'action':'pause'}).status_code==404
    assert a.post(PREFIX+'/focus-sessions',json={'task_id':t['id']}).status_code==409
    with tenant_session(a.user_id) as db:
        row=db.get(FocusSession,focus['id']);row.anchor_at=utcnow()-timedelta(seconds=60)
    paused=a.post(PREFIX+'/focus-sessions/'+focus['id'],json={'version':1,'action':'pause'}).json()
    assert 59<=paused['elapsed']<=63
    assert a.post(PREFIX+'/focus-sessions/'+focus['id'],json={'version':1,'action':'resume'}).status_code==409
    assert a.post(PREFIX+'/focus-sessions/'+focus['id'],json={'version':2,'action':'resume'}).status_code==200
    rule=RecurrenceRule(frequency='monthly',interval=1,mode='calendar',anchor_date=date(2026,1,31))
    assert recurrence_next(rule,date(2026,1,31))==date(2026,2,28)
    assert recurrence_next(rule,date(2026,2,28))==date(2026,3,31)
    from app.common import today
    with tenant_session(a.user_id) as db:
        day=str(today(db.get(User,a.user_id)))
    response=a.post(PREFIX+'/recurrences',json={'template':{'title':'独立周期实例'},'frequency':'daily','start_date':day})
    assert response.status_code==201,response.text
    count=len(a.get(PREFIX+'/tasks').json())
    with tenant_session(a.user_id) as db:
        materialize_recurrences(db,db.get(User,a.user_id))
    assert len(a.get(PREFIX+'/tasks').json())==count
    assert a.post(PREFIX+'/daily-plans',json={'task_id':t['id'],'plan_date':day}).status_code==200
    assert a.put(PREFIX+'/tasks/'+t['id'],json={'title':t['title'],'due_date':day,'version':1}).status_code==200
    entries=a.get(PREFIX+'/calendar?start='+day+'&end='+day).json()
    assert {e['kind'] for e in entries if e['task']['id']==t['id']}=={'plan','due'}
    assert a.post(PREFIX+'/tasks/'+t['id']+'/trash',json={'version':2}).status_code==200
    assert a.post(PREFIX+'/tasks/'+t['id']+'/purge',json={'version':3}).status_code==200
    assert a.get(PREFIX+'/tasks/'+t['id']+'/events').status_code==404


def test_private_table_rls_and_composite_relationships(accounts):
    from sqlalchemy.exc import IntegrityError
    a,b=accounts(),accounts();c=connection(a)
    with tenant_session(b.user_id) as db:
        assert db.scalar(select(ProviderConnection).where(ProviderConnection.id==c['id'])) is None
        assert db.execute(text('SELECT id FROM provider_connections WHERE id=:id'),{'id':c['id']}).first() is None
    with pytest.raises(IntegrityError):
        with tenant_session(b.user_id) as db:
            db.execute(text("INSERT INTO model_preferences(id,user_id,connection_id,model,thinking) VALUES(:id,:user,:conn,'x','auto')"),{'id':str(uuid.uuid4()),'user':b.user_id,'conn':c['id']})
