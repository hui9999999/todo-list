from sqlalchemy import select
from app.common import tenant_session
from app.advanced_models import Conversation, Message, AgentRun, RunEvent

WIPED = '[相关事实已删除，派生回答已清理]'


def seed_runs(client, title):
    with tenant_session(client.user_id) as db:
        linked = Conversation(user_id=client.user_id)
        unrelated = Conversation(user_id=client.user_id)
        db.add_all([linked, unrelated])
        db.flush()
        ask = Message(user_id=client.user_id, conversation_id=linked.id, role='user', content=f'帮我看下{title}')
        other_ask = Message(user_id=client.user_id, conversation_id=unrelated.id, role='user', content='晚饭吃什么')
        db.add_all([ask, other_ask])
        db.flush()
        run = AgentRun(user_id=client.user_id, conversation_id=linked.id, message_id=ask.id,
                       idempotency_key='purge-scope-linked', answer=f'关于{title}的分析')
        other_run = AgentRun(user_id=client.user_id, conversation_id=unrelated.id, message_id=other_ask.id,
                             idempotency_key='purge-scope-unrelated', answer='建议吃面')
        db.add_all([run, other_run])
        db.flush()
        db.add(RunEvent(user_id=client.user_id, run_id=run.id, sequence=1, kind='status', payload={'status': 'running'}))
        db.add(RunEvent(user_id=client.user_id, run_id=other_run.id, sequence=1, kind='status', payload={'status': 'running'}))
        db.add(Message(user_id=client.user_id, conversation_id=linked.id, role='assistant', content=f'总结：{title}需要尽快处理'))
        db.add(Message(user_id=client.user_id, conversation_id=unrelated.id, role='assistant', content='和任务无关的历史回答'))
        return linked.id, unrelated.id, run.id, other_run.id


def test_purge_clears_only_answers_referencing_the_task(accounts):
    client = accounts()
    task = client.post('/api/v1/tasks', json={'title': '敏感任务独有标题'}).json()
    linked_id, unrelated_id, run_id, other_run_id = seed_runs(client, task['title'])
    assert client.post('/api/v1/tasks/' + task['id'] + '/trash', json={'version': 1}).status_code == 200
    assert client.post('/api/v1/tasks/' + task['id'] + '/purge', json={'version': 2}).status_code == 200
    with tenant_session(client.user_id) as db:
        assert db.get(AgentRun, run_id).answer == ''
        assert db.get(AgentRun, other_run_id).answer == '建议吃面'
        assert db.scalar(select(RunEvent).where(RunEvent.run_id == run_id)) is None
        assert db.scalar(select(RunEvent).where(RunEvent.run_id == other_run_id)) is not None
        answers = {m.conversation_id: m.content for m in db.scalars(
            select(Message).where(Message.user_id == client.user_id, Message.role == 'assistant'))}
        assert answers[linked_id] == WIPED
        assert answers[unrelated_id] == '和任务无关的历史回答'


def test_purge_without_any_referencing_content_keeps_all_history(accounts):
    client = accounts()
    task = client.post('/api/v1/tasks', json={'title': '普通删除任务'}).json()
    linked_id, unrelated_id, run_id, other_run_id = seed_runs(client, '完全不同的主题')
    assert client.post('/api/v1/tasks/' + task['id'] + '/trash', json={'version': 1}).status_code == 200
    assert client.post('/api/v1/tasks/' + task['id'] + '/purge', json={'version': 2}).status_code == 200
    with tenant_session(client.user_id) as db:
        for run in (run_id, other_run_id):
            assert db.get(AgentRun, run).answer != ''
        assert db.scalar(select(RunEvent).where(RunEvent.user_id == client.user_id)) is not None
        answers = {m.conversation_id: m.content for m in db.scalars(
            select(Message).where(Message.user_id == client.user_id, Message.role == 'assistant'))}
        assert answers[unrelated_id] == '和任务无关的历史回答'
        assert answers[linked_id] == '总结：完全不同的主题需要尽快处理'
