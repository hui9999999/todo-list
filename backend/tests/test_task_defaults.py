from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.common import tenant_session
from app.models import User
from app.agent import prepare_proposal
from app.ai_schemas import Action

PREFIX = '/api/v1'


def test_default_deadline_uses_account_day_and_preserves_explicit_dates(accounts, monkeypatch):
    import app.tasks as tasks
    client = accounts()
    # UTC Oct 1 is still Sep 30 in Los Angeles; use the account date, not the host's.
    monkeypatch.setattr(tasks, 'utcnow', lambda: datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc))
    with tenant_session(client.user_id) as db:
        db.get(User, client.user_id).timezone = 'America/Los_Angeles'
    response = client.post(PREFIX + '/tasks', json={'title': '默认截止'})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row['due_at'] == '2026-10-01T06:59:00+00:00'
    assert row['due_timezone'] == 'America/Los_Angeles' and row['due_date'] is None
    explicit = client.post(PREFIX + '/tasks', json={'title': '手动日期', 'due_date': '2026-10-04'}).json()
    assert explicit['due_date'] == '2026-10-04' and explicit['due_at'] is None
    no_deadline = client.post(PREFIX + '/tasks', json={'title': '不设截止', 'due_at': None, 'due_date': None}).json()
    assert no_deadline['due_at'] is None and no_deadline['due_date'] is None
    edited = client.put(PREFIX + '/tasks/' + no_deadline['id'], json={'title': '只改名称', 'version': no_deadline['version']}).json()
    assert edited['due_at'] is None and edited['due_date'] is None
    child = client.post(PREFIX + '/tasks', json={'title': '子任务', 'parent_id': row['id']}).json()
    assert child['due_at'] == row['due_at']


def test_ai_default_deadline_visible_before_confirmation(accounts, monkeypatch):
    import app.tasks as tasks
    client = accounts()
    monkeypatch.setattr(tasks, 'utcnow', lambda: datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc))
    with tenant_session(client.user_id) as db:
        proposal = prepare_proposal(db, db.get(User, client.user_id), [
            Action.model_validate({'kind': 'create', 'fields': {'title': '默认 AI 任务'}}),
            Action.model_validate({'kind': 'create', 'fields': {'title': '显式不设截止', 'due_at': None, 'due_date': None}}),
        ], '截止时间预览')
        identifier = proposal.id
        assert proposal.actions[0]['fields']['due_at'] == '2026-10-01T15:59:00Z'
        assert proposal.actions[0]['fields']['due_timezone'] == 'Asia/Shanghai'
        assert proposal.actions[1]['fields']['due_at'] is None
    assert client.get(PREFIX + '/tasks').json() == []
    response = client.post(PREFIX + '/action-proposals/' + identifier + '/confirm', json={'version': 1})
    assert response.status_code == 200, response.text
    rows = client.get(PREFIX + '/tasks').json()
    default = next(row for row in rows if row['title'] == '默认 AI 任务')
    assert datetime.fromisoformat(default['due_at']).astimezone(ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d %H:%M') == '2026-10-01 23:59'
    assert next(row for row in rows if row['title'] == '显式不设截止')['due_at'] is None
