from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
import json
import pytest
from sqlalchemy import select
from app.common import tenant_session, today
from app.models import User, utcnow
from app.advanced_models import Recommendation
from app.agent import prepare_proposal
from app.ai_schemas import Action
from test_p1_p4 import connection, settings_body


def test_suggestions_subtract_existing_plans_and_do_not_resuggest_them(accounts):
    import app.suggestions as suggestions
    a=accounts()
    planned=a.post('/api/v1/tasks',json={'title':'已安排90分钟','estimated_minutes':90}).json()
    too_large=a.post('/api/v1/tasks',json={'title':'额外40分钟','estimated_minutes':40,'due_date':None,'due_at':None}).json()
    fitting=a.post('/api/v1/tasks',json={'title':'额外20分钟','estimated_minutes':20,'due_date':None,'due_at':None}).json()
    pref=a.put('/api/v1/settings',json=settings_body(a,suggestions_enabled=True,daily_capacity=120)).json()
    with tenant_session(a.user_id) as db:
        day=str(today(db.get(User,a.user_id)))
    assert a.post('/api/v1/daily-plans',json={'task_id':planned['id'],'plan_date':day}).status_code==200
    suggestions.generate_suggestions(a.user_id,{'date':day,'settings_version':pref['version']})
    items=a.get('/api/v1/recommendations').json()
    assert [item['title'] for item in items]==[fitting['title']],items


@pytest.mark.parametrize('changed',[{'timezone':'America/Los_Angeles'},{'daily_capacity':60},{'work_start':'10:00'}])
def test_changed_planning_constraints_invalidate_old_proposals(accounts,changed):
    a=accounts();task=a.post('/api/v1/tasks',json={'title':'旧条件下的安排'}).json()
    with tenant_session(a.user_id) as db:
        user=db.get(User,a.user_id)
        proposal=prepare_proposal(db,user,[Action(kind='plan',task_id=task['id'],version=1,plan_date=today(user))],'旧条件')
        identifier=proposal.id
    assert a.put('/api/v1/settings',json=settings_body(a,**changed)).status_code==200
    assert a.post('/api/v1/action-proposals/'+identifier+'/confirm',json={'version':1}).status_code==409


def test_future_recurrence_rejects_foreign_or_missing_project(accounts):
    a,b=accounts(),accounts()
    project=b.post('/api/v1/projects',json={'title':'其他用户项目'}).json()
    with tenant_session(a.user_id) as db:
        future=str(today(db.get(User,a.user_id))+timedelta(days=10))
    for identifier in [project['id'],'missing-project']:
        response=a.post('/api/v1/recurrences',json={'template':{'title':'未来实例','project_id':identifier},'frequency':'daily','start_date':future})
        assert response.status_code==404,response.text
    assert a.get('/api/v1/recurrences').json()==[]


def test_concurrent_suggestion_jobs_publish_no_duplicates(accounts,monkeypatch):
    import app.suggestions as suggestions
    a=accounts();connection(a)
    tasks=[a.post('/api/v1/tasks',json={'title':f'待办 {i}','due_date':None,'due_at':None}).json() for i in range(5)]
    pref=a.put('/api/v1/settings',json=settings_body(a,suggestions_enabled=True)).json()
    with tenant_session(a.user_id) as db:
        day=str(today(db.get(User,a.user_id)))
    barrier=Barrier(2)
    def concurrent_stream(conn,request):
        barrier.wait(timeout=10)
        value={'items':[{'title':tasks[0]['title'],'reason':'优先安排这项','source_task_id':tasks[0]['id'],
                        'action':{'kind':'plan','task_id':tasks[0]['id'],'version':1,'plan_date':day}}]}
        yield {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'suggest_today','arguments':json.dumps(value)}}]},'finish_reason':'tool_calls'}]}
    monkeypatch.setattr(suggestions,'stream_chat',concurrent_stream)
    payload={'date':day,'settings_version':pref['version']}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(suggestions.generate_suggestions,a.user_id,payload) for _ in range(2)]
        for future in futures:
            future.result(timeout=20)
    items=a.get('/api/v1/recommendations').json()
    assert len(items)==5 and len({item['title'] for item in items})==5,items


def test_one_invalid_legacy_recurrence_does_not_stop_other_users_worker(accounts,monkeypatch):
    import app.worker as worker
    from app.advanced_models import RecurrenceRule,Job
    a,b=accounts(),accounts()
    with tenant_session(a.user_id) as db:
        day=today(db.get(User,a.user_id))
        db.add(RecurrenceRule(user_id=a.user_id,template={'title':'旧无效规则','project_id':'missing-project'},
            frequency='daily',interval=1,mode='calendar',anchor_date=day,next_date=day))
    monkeypatch.setattr(worker,'user_ids',lambda:[a.user_id,b.user_id])
    worker.tick()
    with tenant_session(b.user_id) as db:
        assert db.scalar(select(Job).where(Job.user_id==b.user_id,Job.kind=='maintenance')).state=='completed'


def test_replanning_after_capacity_change_replaces_invalid_suggestions(accounts):
    import app.suggestions as suggestions
    a=accounts()
    for i in range(5):
        a.post('/api/v1/tasks',json={'title':f'安排 {i}','estimated_minutes':10,'due_date':None,'due_at':None})
    pref=a.put('/api/v1/settings',json=settings_body(a,suggestions_enabled=True,daily_capacity=50)).json()
    with tenant_session(a.user_id) as db:
        day=str(today(db.get(User,a.user_id)))
    suggestions.generate_suggestions(a.user_id,{'date':day,'settings_version':pref['version']})
    pref=a.put('/api/v1/settings',json=settings_body(a,daily_capacity=20)).json()
    suggestions.generate_suggestions(a.user_id,{'date':day,'settings_version':pref['version']})
    items=a.get('/api/v1/recommendations').json()
    assert len([item for item in items if item['state']=='pending'])==2
    assert len([item for item in items if item['state']=='expired'])==5
