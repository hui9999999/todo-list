import pytest
import json
from fastapi import HTTPException
from app.agent import prepare_proposal, confirm_proposal
from app.ai_schemas import Action
from app.common import tenant_session
from app.models import User
from test_p0 import create, update

PREFIX = '/api/v1'


def test_failure_requires_reason_and_retry_preserves_history(accounts):
    client = accounts()
    task = create(client, '申请资格')
    assert update(client, task, status='failed', fail_reason='  ').status_code == 422
    assert client.post(PREFIX + '/tasks', json={'title': '失败任务', 'status': 'failed'}).status_code == 422
    failed = update(client, task, status='failed', fail_reason='  申请被拒绝  ').json()
    assert failed['fail_reason'] == '申请被拒绝'
    retry = update(client, failed, status='todo').json()
    assert retry['status'] == 'todo' and retry['fail_reason'] == ''
    events = client.get(PREFIX + '/tasks/' + task['id'] + '/events').json()
    assert events[-2]['after']['fail_reason'] == '申请被拒绝'
    assert events[-1]['before']['status'] == 'failed'
    assert events[-1]['before']['fail_reason'] == '申请被拒绝'
    failed_again = update(client, retry, status='failed', fail_reason='未达到要求').json()
    assert events[-2]['after']['fail_reason'] != failed_again['fail_reason']


@pytest.mark.parametrize('outcome', ['done', 'failed', 'cancelled'])
def test_active_children_block_every_parent_outcome(accounts, outcome):
    client = accounts()
    parent = create(client, '父任务')
    create(client, '还在做', parent_id=parent['id'], status='doing')
    response = update(client, parent, status=outcome, fail_reason='未达成目标')
    assert response.status_code == 409
    assert '子任务' in response.json()['detail']


def test_failed_children_need_review_but_can_close_parent(accounts):
    client = accounts()
    parent = create(client, '父任务')
    failed = create(client, '失败子任务', parent_id=parent['id'], status='failed', fail_reason='审核未通过')
    current = client.get(PREFIX + '/tasks/' + parent['id']).json()
    assert current['workflow']['active_children'] == []
    assert current['workflow']['failed_children'][0]['id'] == failed['id']
    assert update(client, parent, status='done').status_code == 409
    review = {failed['id']: failed['version']}
    changed = update(client, failed, fail_reason='审核仍未通过').json()
    assert update(client, parent, status='done', confirmed_failed_children=review).status_code == 409
    completed = update(client, parent, status='done', confirmed_failed_children={changed['id']: changed['version']})
    assert completed.status_code == 200, completed.text
    assert client.get(PREFIX + '/tasks/' + failed['id']).json()['status'] == 'failed'
    assert update(client, changed, status='todo').status_code == 409


@pytest.mark.parametrize('outcome', ['failed', 'cancelled'])
def test_parent_can_choose_other_outcomes_without_rewriting_failed_children(accounts, outcome):
    client = accounts()
    parent = create(client, '父任务')
    child = create(client, '失败子任务', parent_id=parent['id'], status='failed', fail_reason='未通过')
    closed = update(client, parent, status=outcome, fail_reason='目标未达成')
    assert closed.status_code == 200, closed.text
    assert client.get(PREFIX + '/tasks/' + child['id']).json()['status'] == 'failed'
    assert client.post(PREFIX + '/tasks', json={'title': '新子任务', 'parent_id': parent['id']}).status_code == 409


def test_failed_dependency_blocks_start_and_completion_and_updates_live(accounts):
    client, other = accounts(), accounts()
    prerequisite = create(client, '审核', status='failed', fail_reason='审核失败')
    task = create(client, '发布')
    result = client.post(PREFIX + '/tasks/' + task['id'] + '/dependencies', json={
        'version': task['version'], 'depends_on_id': prerequisite['id']})
    task = client.get(PREFIX + '/tasks/' + task['id']).json()
    assert result.status_code == 200
    assert task['workflow']['blocking_dependencies'][0]['fail_reason'] == '审核失败'
    assert other.get(PREFIX + '/tasks/' + task['id']).status_code == 404
    assert update(client, task, status='doing').status_code == 409
    assert update(client, task, status='done', confirmed_failed_children={prerequisite['id']: 1}).status_code == 409
    retry = update(client, prerequisite, status='todo').json()
    done = update(client, retry, status='done').json()
    assert done['status'] == 'done'
    current = client.get(PREFIX + '/tasks/' + task['id']).json()
    assert current['workflow']['blocking_dependencies'] == []
    assert update(client, current, status='done').status_code == 200


def test_trashing_dependency_does_not_silently_satisfy_it(accounts):
    client = accounts()
    prerequisite = create(client, '必要资料')
    task = create(client, '发布')
    client.post(PREFIX + '/tasks/' + task['id'] + '/dependencies', json={'version': 1, 'depends_on_id': prerequisite['id']})
    client.post(PREFIX + '/tasks/' + prerequisite['id'] + '/trash', json={'version': 1})
    current = client.get(PREFIX + '/tasks/' + task['id']).json()
    assert current['workflow']['blocking_dependencies'][0]['deleted']
    assert update(client, current, status='done').status_code == 409
    edge = client.get(PREFIX + '/tasks/' + task['id'] + '/dependencies').json()[0]
    client.delete(PREFIX + '/tasks/' + task['id'] + '/dependencies/' + edge['id'] + '?version=' + str(current['version']))
    current = client.get(PREFIX + '/tasks/' + task['id']).json()
    assert current['workflow']['blocking_dependencies'] == []
    assert update(client, current, status='done').status_code == 200


def test_ai_parent_completion_review_uses_server_snapshot(accounts):
    client = accounts()
    parent = create(client, '父任务')
    child = create(client, '失败子任务', parent_id=parent['id'], status='failed', fail_reason='未通过')
    with tenant_session(client.user_id) as db:
        user = db.get(User, client.user_id)
        proposal = prepare_proposal(db, user, [Action.model_validate({
            'kind': 'update', 'task_id': parent['id'], 'version': 1,
            'fields': {'title': parent['title'], 'status': 'done'},
        })], '确认父任务整体目标已完成')
        assert proposal.actions[0]['confirmed_failed_children'] == {child['id']: child['version']}
        confirm_proposal(db, user, proposal, proposal.version)
    assert client.get(PREFIX + '/tasks/' + parent['id']).json()['status'] == 'done'


def test_ai_cannot_prepare_failure_without_reason(accounts):
    client = accounts()
    task = create(client)
    with tenant_session(client.user_id) as db:
        with pytest.raises(HTTPException) as error:
            prepare_proposal(db, db.get(User, client.user_id), [Action.model_validate({
                'kind': 'update', 'task_id': task['id'], 'version': 1,
                'fields': {'title': task['title'], 'status': 'failed'},
            })], '失败')
        assert error.value.status_code == 422


def test_legacy_failure_without_reason_can_be_imported_and_retried(accounts):
    client = accounts()
    preview = client.post(PREFIX + '/imports/preview', json={'content': json.dumps([
        {'id': 1, 'text': '旧失败任务', 'status': 'fail'},
    ])}).json()
    assert not preview['issues']
    assert client.post(PREFIX + '/imports/' + preview['id'] + '/confirm').status_code == 200
    task = client.get(PREFIX + '/tasks').json()[0]
    assert task['status'] == 'failed' and task['fail_reason'] == ''
    assert update(client, task, status='todo').status_code == 200
    backup = client.get(PREFIX + '/exports').json()
    assert 'workflow' not in backup['tasks'][0]
    events = client.get(PREFIX + '/tasks/' + task['id'] + '/events').json()
    assert events[-1]['before']['status'] == 'failed'


def test_ai_undo_reopen_restores_previously_reviewed_parent(accounts):
    client = accounts()
    parent = create(client, '父任务')
    child = create(client, '失败子任务', parent_id=parent['id'], status='failed', fail_reason='未通过')
    parent = update(client, parent, status='done', confirmed_failed_children={child['id']: child['version']}).json()
    with tenant_session(client.user_id) as db:
        proposal = prepare_proposal(db, db.get(User, client.user_id), [Action.model_validate({
            'kind': 'update', 'task_id': parent['id'], 'version': parent['version'],
            'fields': {'title': parent['title'], 'status': 'todo'},
        })], '重新打开父任务')
        identifier = proposal.id
        confirm_proposal(db, db.get(User, client.user_id), proposal, proposal.version)
    assert client.get(PREFIX + '/tasks/' + parent['id']).json()['status'] == 'todo'
    response = client.post(PREFIX + '/actions/' + identifier + '/undo')
    assert response.status_code == 200, response.text
    assert client.get(PREFIX + '/tasks/' + parent['id']).json()['status'] == 'done'


def test_parent_completion_checks_nested_failures(accounts):
    client = accounts()
    root = create(client, '父任务')
    middle = create(client, '子任务', parent_id=root['id'])
    nested = create(client, '孙任务', parent_id=middle['id'], status='failed', fail_reason='未通过')
    assert update(client, middle, status='cancelled').status_code == 200
    assert update(client, root, status='done').status_code == 409
    assert update(client, root, status='done', confirmed_failed_children={nested['id']: nested['version']}).status_code == 200
