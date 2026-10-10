FLAGS = ('memory_enabled', 'followups_enabled', 'news_enabled', 'suggestions_enabled', 'notifications_enabled', 'weather_enabled')


def test_new_preferences_enabled_and_saved_choices_preserved(accounts):
    client = accounts()
    settings = client.get('/api/v1/settings').json()
    assert all(settings[flag] is True for flag in FLAGS)
    payload = {key: settings[key] for key in ('version', 'timezone', *FLAGS, 'weather_city', 'theme', 'work_start', 'work_end', 'daily_capacity', 'recommendation_time', 'daily_call_limit', 'daily_token_limit')}
    payload.update(weather_enabled=False, notifications_enabled=False, news_enabled=False, weather_city='苏州')
    result = client.put('/api/v1/settings', json=payload)
    assert result.status_code == 200, result.text
    saved = client.get('/api/v1/settings').json()
    assert saved['weather_enabled'] is saved['notifications_enabled'] is saved['news_enabled'] is False
    assert saved['weather_city'] == '苏州'
    assert saved['suggestions_enabled'] is saved['memory_enabled'] is saved['followups_enabled'] is True
