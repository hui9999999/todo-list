import pytest

from app.agent import prepare_proposal
from app.ai_schemas import Action
from app.common import tenant_session
from app.models import User
from app.task_scope import infer_scope

PREFIX = '/api/v1'


@pytest.mark.parametrize('title,notes,expected', [
    ('买牛奶', '', 'life'), ('整理房间', '', 'life'), ('交房租', '', 'life'),
    ('跑步半小时', '', 'life'), ('复习英语单词', '', 'study'),
    ('学习 Python 编程', '', 'study'), ('看书', '', 'study'),
    ('完成数学作业', '', 'study'), ('准备项目评审资料', '', 'work'),
    ('给客户发送合同', '', 'work'), ('编写工作周报', '', 'work'),
    ('准备材料', '明天的英语课程需要复习单词', 'study'),
    ('买牛奶', '工作结束后顺便去超市', 'life'),
    ('复习项目管理课程', '', 'study'), ('阅读项目需求', '', 'work'),
    ('Complete homework', '', 'study'), ('Client meeting', '', 'work'),
    ('任务测试', '', 'unassigned'), ('处理一下', '', 'unassigned'),
    ('学习和工作', '', 'unassigned'),
])
def test_classification(title, notes, expected):
    assert infer_scope(title, notes) == expected


def test_preview_creation_manual_override_and_edit(accounts):
    client = accounts()
    for title, expected in [('买牛奶', 'life'), ('复习英语', 'study'), ('准备客户会议', 'work')]:
        preview = client.post(PREFIX + '/tasks/classify', json={'title': title})
        assert preview.status_code == 200, preview.text
        assert preview.json()['scope'] == expected
        # Previewing must not create a task or a plan.
        before = len(client.get(PREFIX + '/tasks').json())
        assert before == [('买牛奶', 'life'), ('复习英语', 'study'), ('准备客户会议', 'work')].index((title, expected))
        response = client.post(PREFIX + '/tasks', json={'title': title})
        assert response.status_code == 201, response.text
        assert response.json()['scope'] == expected
    explicit = client.post(PREFIX + '/tasks', json={'title': '复习英语', 'scope': 'life'}).json()
    assert explicit['scope'] == 'life'
    unknown = client.post(PREFIX + '/tasks', json={'title': '复习英语', 'scope': 'unassigned'}).json()
    assert unknown['scope'] == 'unassigned'
    edited = client.put(PREFIX + '/tasks/' + explicit['id'], json={
        'title': '准备客户会议', 'scope': 'life', 'version': explicit['version']})
    assert edited.status_code == 200 and edited.json()['scope'] == 'life'
    notes = client.post(PREFIX + '/tasks', json={'title': '准备材料', 'notes': '明天的英语课程'}).json()
    assert notes['scope'] == 'study'
    assert client.post(PREFIX + '/tasks/classify', json={'title': ' '}).status_code == 422


def test_ai_preview_and_confirmation_have_same_classification(accounts):
    client = accounts()
    with tenant_session(client.user_id) as db:
        proposal = prepare_proposal(db, db.get(User, client.user_id), [
            Action.model_validate({'kind': 'create', 'fields': {'title': '复习英语单词'}}),
            Action.model_validate({'kind': 'create', 'fields': {'title': '买牛奶', 'scope': 'work'}}),
        ], '分类预览')
        identifier = proposal.id
        assert [action['fields']['scope'] for action in proposal.actions] == ['study', 'work']
    assert client.get(PREFIX + '/tasks').json() == []
    response = client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1})
    assert response.status_code == 200, response.text
    assert {task['title']: task['scope'] for task in client.get(PREFIX + '/tasks').json()} == {
        '复习英语单词': 'study', '买牛奶': 'work'}
