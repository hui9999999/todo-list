from test_p1_p4 import PREFIX, task


DAY = '2026-10-09'


def entries(client):
    response = client.get(PREFIX + '/calendar', params={'start': DAY, 'end': DAY})
    assert response.status_code == 200, response.text
    return response.json()


def plan(client, row):
    response = client.post(PREFIX + '/daily-plans', json={'task_id': row['id'], 'plan_date': DAY})
    assert response.status_code == 200, response.text


def test_calendar_excludes_cancelled_copies_and_preserves_current_plans(accounts):
    client = accounts()
    current = []
    cancelled = []
    for title in ('背面试题', '构思简历'):
        cancelled.append(task(client, title, status='cancelled', due_at=DAY + 'T23:59:00+08:00', due_timezone='Asia/Shanghai'))
        row = task(client, title, due_date=DAY)
        plan(client, row)
        current.append(row)

    plans_before = client.get(PREFIX + '/daily-plans', params={'plan_date': DAY}).json()
    result = entries(client)
    assert {e['task']['id'] for e in result} == {t['id'] for t in current}
    assert all({e['kind'] for e in result if e['task']['id'] == row['id']} == {'due', 'plan'} for row in current)
    # Calendar reads leave cancelled records and current arrangements intact.
    assert {t['id'] for t in client.get(PREFIX + '/tasks').json()} == {t['id'] for t in current + cancelled}
    assert client.get(PREFIX + '/daily-plans', params={'plan_date': DAY}).json() == plans_before


def test_calendar_visibility_applies_to_due_dates_and_manual_plans(accounts):
    client, other = accounts(), accounts()
    visible = []
    for status in ('todo', 'doing', 'done', 'failed', 'cancelled'):
        row = task(client, '同名任务', status=status, due_date=DAY, fail_reason='测试失败' if status == 'failed' else '')
        plan(client, row)
        if status in ('todo', 'doing', 'done'):
            visible.append(row)
    hidden = task(client, '隐藏任务', hidden=True, due_date=DAY)
    plan(client, hidden)
    trashed = task(client, '垃圾站任务', due_date=DAY)
    plan(client, trashed)
    assert client.post(PREFIX + '/tasks/' + trashed['id'] + '/trash', json={'version': trashed['version']}).status_code == 200
    foreign = task(other, '其他账号任务', due_date=DAY)
    plan(other, foreign)

    result = entries(client)
    assert {e['task']['id'] for e in result} == {t['id'] for t in visible}
    assert len(result) == 6
    assert all({e['kind'] for e in result if e['task']['id'] == row['id']} == {'due', 'plan'} for row in visible)
