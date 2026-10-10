"""Meal choices use the existing tenant-scoped memory API and AI context."""
def test_food_choices_replace_same_meal_and_preferences_reach_ai_context(accounts):
    from app.common import tenant_session
    from app.memory import context_memories
    a, b = accounts(), accounts()
    prefix = '/api/v1'

    def remember(key, content, kind='interest', pinned=False):
        response = a.post(prefix+'/memories', json={
            'key': key, 'content': content, 'scope': 'life', 'kind': kind, 'pinned': pinned,
        })
        assert response.status_code == 201, response.text
        return response.json()

    first = remember('food:choice:2026-10-05:breakfast', '2026-10-05 早餐确认选择包子；仅为本次计划。')
    latest = remember('food:choice:2026-10-05:breakfast', '2026-10-05 早餐确认选择馒头；仅为本次计划。')
    next_day = remember('food:choice:2026-10-06:breakfast', '2026-10-06 早餐确认选择粥；仅为本次计划。')
    taste = remember('food:preferences', '饮食口味偏好：喜欢面食，不喜欢香菜。', 'preference', True)
    rows = a.get(prefix+'/memories').json()
    assert next(row for row in rows if row['id'] == first['id'])['effective_state'] == 'superseded'
    assert {row['id'] for row in rows if row['effective_state'] == 'active'} == {latest['id'], next_day['id'], taste['id']}
    assert b.get(prefix+'/memories').json() == []
    assert b.post(prefix+'/memories/'+taste['id']+'/forget').status_code == 404
    with tenant_session(a.user_id) as db:
        context = context_memories(db, a.user_id, 'life')
        assert context[0]['id'] == taste['id']
        assert {row['id'] for row in context} == {latest['id'], next_day['id'], taste['id']}
        assert context_memories(db, a.user_id, 'work') == []
    assert a.post(prefix+'/memories/'+taste['id']+'/forget').status_code == 200
    with tenant_session(a.user_id) as db:
        assert taste['id'] not in {row['id'] for row in context_memories(db, a.user_id)}


def test_multi_dish_menu_removal_and_empty_snapshot_replace_old_context(accounts):
    from app.common import tenant_session
    from app.memory import context_memories
    a, b = accounts(), accounts()
    key = 'food:choice:2026-10-06:lunch'

    def save(names):
        choices = '、'.join('「'+name+'」' for name in names) if names else '（菜单已清空）'
        content = '2026-10-06 的午餐确认选择了'+choices+'。这是本次用餐计划，不代表已经吃过或长期喜好。'
        response = a.post('/api/v1/memories', json={
            'key': key, 'content': content, 'scope': 'life', 'kind': 'interest', 'pinned': False,
        })
        assert response.status_code == 201, response.text
        return response.json()

    first = save(['辣椒炒腊肉', '清炒白菜', '清蒸鲈鱼', '剁椒鱼头'])
    remaining = save(['清炒白菜', '清蒸鲈鱼', '剁椒鱼头'])
    with tenant_session(a.user_id) as db:
        current = [row for row in context_memories(db, a.user_id, 'life') if row['key'] == key]
        assert len(current) == 1 and current[0]['id'] == remaining['id']
        assert '辣椒炒腊肉' not in current[0]['content']
    empty = save([])
    rows = a.get('/api/v1/memories').json()
    assert next(row for row in rows if row['id'] == first['id'])['effective_state'] == 'superseded'
    assert next(row for row in rows if row['id'] == remaining['id'])['effective_state'] == 'superseded'
    assert [row['id'] for row in rows if row['key'] == key and row['effective_state'] == 'active'] == [empty['id']]
    with tenant_session(a.user_id) as db:
        current = [row for row in context_memories(db, a.user_id, 'life') if row['key'] == key]
        assert len(current) == 1 and '菜单已清空' in current[0]['content']
        assert '清蒸鲈鱼' not in current[0]['content']
    assert b.get('/api/v1/memories').json() == []
