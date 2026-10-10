import json
import uuid
import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import ValidationError
from app.config import settings
from app.common import tenant_session
from app.advanced_models import ProviderConnection, ForgetRequest
from app.ai_schemas import AgentOutput
from test_p1_p4 import PREFIX, connection, output_stream
from test_ai_task_operations import json_stream
from app.web_search import search_web


RSS = b'''<rss><channel><item><title>Python docs</title><link>https://docs.python.org/3/</link><description>&lt;b&gt;Official&lt;/b&gt; docs &amp; examples.</description></item><item><title>Duplicate</title><link>https://docs.python.org/3/</link></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item><item><title>Local</title><link>http://127.0.0.1/private</link></item></channel></rss>'''


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())
    monkeypatch.setattr('app.web_search._exa_retry_after', 0.0)


def mock_network(monkeypatch, handler):
    real = httpx.Client
    monkeypatch.setattr('app.web_search.Client', lambda **kwargs: real(**kwargs, transport=httpx.MockTransport(handler)))


def test_search_reads_real_rss_fields_and_rejects_unsafe_links(monkeypatch):
    def respond(request):
        assert request.url.host == 'cn.bing.com' and request.url.params['q'] == 'Python docs'
        assert request.url.params['format'] == 'rss' and 'authorization' not in request.headers
        return httpx.Response(200, content=RSS)
    mock_network(monkeypatch, respond)
    result = search_web('Python docs')
    assert result == [{'title': 'Python docs', 'url': 'https://docs.python.org/3/', 'snippet': 'Official docs & examples.', 'site': 'docs.python.org', 'published_at': None}]


@pytest.mark.parametrize('status,body', [(429, b''), (200, b'bad xml'), (200, b'x' * 131073), (200, b'<!DOCTYPE rss><rss/>')], ids=['limited','invalid','oversized','doctype'])
def test_search_failures_are_honest_and_bounded(monkeypatch, status, body):
    mock_network(monkeypatch, lambda request: httpx.Response(status, content=body))
    with pytest.raises(HTTPException):
        search_web('test')


def test_empty_search_and_timeout(monkeypatch):
    mock_network(monkeypatch, lambda request: httpx.Response(200, content=b'<rss><channel/></rss>'))
    assert search_web('test') == []
    def timeout(request):
        raise httpx.ReadTimeout('private transport details')
    mock_network(monkeypatch, timeout)
    with pytest.raises(HTTPException) as error:
        search_web('test')
    assert 'private transport' not in error.value.detail


def test_news_search_uses_international_results_and_falls_back(monkeypatch):
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'rss')
    calls = []
    def respond(request):
        calls.append(dict(request.url.params))
        if request.url.params.get('mkt') == 'en-US':
            assert request.url.params['cc'] == 'US'
            return httpx.Response(200, content=b'<rss><channel/></rss>')
        return httpx.Response(200, content=RSS)
    mock_network(monkeypatch, respond)
    assert search_news('Jev AI model')[0]['url'] == 'https://docs.python.org/3/'
    assert len(calls) == 2 and all(c['q'] == 'Jev AI model' for c in calls)


def test_news_search_keeps_international_evidence_without_extra_request(monkeypatch):
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'rss')
    calls = []
    def respond(request):
        calls.append(request)
        assert request.url.params['mkt'] == 'en-US'
        return httpx.Response(200, content=RSS)
    mock_network(monkeypatch, respond)
    assert search_news('Jev AI model')[0]['snippet'] == 'Official docs & examples.'
    assert len(calls) == 1


def test_configured_search_keeps_article_date_and_validates_sources(monkeypatch):
    from pydantic import SecretStr
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'bocha')
    monkeypatch.setattr(settings(), 'bocha_search_api_key', SecretStr('search-test-key'))
    def respond(request):
        assert request.url.host == 'api.bochaai.com'
        assert request.headers['authorization'] == 'Bearer search-test-key'
        body = json.loads(request.content)
        assert body == {'query': 'DeepSeek', 'freshness': 'oneMonth', 'summary': True, 'count': 10}
        return httpx.Response(200, json={'code': 200, 'data': {'webPages': {'value': [
            {'name': '<b>DeepSeek release</b>', 'url': 'https://api-docs.deepseek.com/news/release',
             'summary': '<p>Official release details.</p>', 'datePublished': '2026-10-08T10:00:00+08:00'},
            {'name': 'Duplicate', 'url': 'https://api-docs.deepseek.com/news/release'},
            {'name': 'Private URL', 'url': 'http://127.0.0.1/private'},
            {'name': 'Invalid type', 'url': 'https://example.com/source', 'summary': {'bad': True},
             'dateLastCrawled': '2026-10-09T10:00:00+08:00'},
        ]}}})
    mock_network(monkeypatch, respond)
    result = search_news('DeepSeek')
    assert len(result) == 2
    assert result[0]['published_at'] == '2026-10-08T10:00:00+08:00'
    assert result[0]['snippet'] == 'Official release details.'
    assert result[1]['published_at'] is None and result[1]['snippet'] == ''


@pytest.mark.parametrize('status,body,expected', [
    (401, b'private-key-from-upstream', 409), (403, b'', 409), (429, b'', 429),
    (500, b'', 502), (200, b'bad json', 502), (200, b'x'*131073, 502),
    (200, b'{"code":200,"data":{}}', 502),
], ids=['unauthorized', 'forbidden', 'limited', 'upstream', 'invalid-json', 'oversized', 'missing-results'])
def test_configured_search_errors_are_bounded_and_do_not_leak_credentials(monkeypatch, status, body, expected):
    from pydantic import SecretStr
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'bocha')
    monkeypatch.setattr(settings(), 'bocha_search_api_key', SecretStr('private-test-key'))
    mock_network(monkeypatch, lambda request: httpx.Response(status, content=body))
    with pytest.raises(HTTPException) as error:
        search_news('DeepSeek')
    assert error.value.status_code == expected
    assert 'private' not in error.value.detail


def test_missing_search_key_does_not_send_requests_or_silently_fall_back(monkeypatch):
    from pydantic import SecretStr
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'bocha')
    monkeypatch.setattr(settings(), 'bocha_search_api_key', SecretStr(''))
    monkeypatch.setattr(settings(), 'bocha_search_key_file', '')
    mock_network(monkeypatch, lambda request: pytest.fail('Missing credential must not make a network request'))
    with pytest.raises(HTTPException) as error:
        search_news('DeepSeek')
    assert error.value.status_code == 409


def test_search_credential_file_is_private_and_explicit(monkeypatch, tmp_path):
    from pydantic import SecretStr
    from app.web_search import search_news
    keyfile = tmp_path / 'search.key'
    keyfile.write_text('search-test-key\n')
    monkeypatch.setattr(settings(), 'news_search_provider', 'bocha')
    monkeypatch.setattr(settings(), 'bocha_search_api_key', SecretStr(''))
    monkeypatch.setattr(settings(), 'bocha_search_key_file', str(keyfile))
    def respond(request):
        assert request.headers['authorization'] == 'Bearer search-test-key'
        return httpx.Response(200, json={'code': 200, 'data': {'webPages': {'value': []}}})
    mock_network(monkeypatch, respond)
    assert search_news('DeepSeek') == []


def exa_response(rows, sse=True):
    envelope = {'jsonrpc': '2.0', 'id': 1, 'result': {'content': [
        {'type': 'text', 'text': json.dumps({'results': rows})}]}}
    body = json.dumps(envelope)
    return ('event: message\ndata: ' + body + '\n\n' if sse else body).encode()


@pytest.mark.parametrize('sse', [True, False])
def test_free_news_search_uses_keyless_exa_with_dates_and_safe_sources(monkeypatch, sse):
    from pydantic import SecretStr
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'free')
    monkeypatch.setattr(settings(), 'bocha_search_api_key', SecretStr('must-never-be-sent'))
    def respond(request):
        assert request.url.host == 'mcp.exa.ai'
        assert 'authorization' not in request.headers and 'x-api-key' not in request.headers
        data = json.loads(request.content)
        assert data['method'] == 'tools/call' and data['params']['name'] == 'web_search_advanced_exa'
        args = data['params']['arguments']
        assert args['query'] == 'DeepSeek' and args['numResults'] == 8 and args['category'] == 'news'
        assert 'startPublishedDate' in args and 'startCrawlDate' not in args
        return httpx.Response(200, content=exa_response([
            {'title': 'DeepSeek release', 'url': 'https://example.com/release',
             'text': '<p>Release details</p>', 'publishedDate': '2026-10-08T01:00:00Z'},
            {'title': 'Duplicate', 'url': 'https://example.com/release'},
            {'title': 'Local', 'url': 'http://127.0.0.1/private'},
            {'title': 'Other report', 'url': 'https://other.example/report',
             'highlights': ['Report summary', 123], 'crawlDate': '2026-10-09T01:00:00Z'},
        ], sse))
    mock_network(monkeypatch, respond)
    rows = search_news('DeepSeek')
    assert len(rows) == 2 and rows[0]['snippet'] == 'Release details'
    assert rows[0]['published_at'] == '2026-10-08T01:00:00+00:00'
    assert rows[1]['snippet'] == 'Report summary' and rows[1]['published_at'] is None


@pytest.mark.parametrize('status,body', [(429, b'private details'), (500, b''),
    (200, b'x'*131073), (200, b'bad response'),
    (200, b'{"id":1,"error":{"message":"private details"}}'),
    (200, b'{"id":1,"result":{"isError":true,"content":[]}}')],
    ids=['limited', 'unavailable', 'oversized', 'invalid', 'rpc-error', 'tool-error'])
def test_free_search_failure_cools_down_without_paid_fallback(monkeypatch, status, body):
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'free')
    calls = []
    def respond(request):
        calls.append(request)
        assert request.url.host == 'mcp.exa.ai'
        return httpx.Response(status, content=body)
    mock_network(monkeypatch, respond)
    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            search_news('DeepSeek')
        assert 'private' not in error.value.detail
    assert len(calls) == 1


def test_free_search_empty_is_valid_but_timeout_preserves_feed_fallback(monkeypatch):
    from app.web_search import search_news
    monkeypatch.setattr(settings(), 'news_search_provider', 'free')
    mock_network(monkeypatch, lambda request: httpx.Response(200, content=exa_response([])))
    assert search_news('unfamiliar name') == []
    def timeout(request):
        raise httpx.ConnectTimeout('private network data')
    mock_network(monkeypatch, timeout)
    with pytest.raises(HTTPException) as error:
        search_news('DeepSeek')
    assert '订阅来源' in error.value.detail and 'private' not in error.value.detail


@pytest.mark.parametrize('tools', [True, False])
def test_search_then_answer_sources_restore_and_remain_private(accounts, monkeypatch, tools):
    import app.agent as agent
    client, other = accounts(), accounts()
    conn = connection(client)
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': tools}}
    requested = []
    def search(q):
        requested.append(q)
        return [{'title': 'Python docs', 'url': 'https://docs.python.org/3/', 'site': 'docs.python.org', 'snippet': 'Official documentation', 'published_at': None}]
    monkeypatch.setattr(agent, 'search_web', search)
    rounds = []
    def respond(c, payload):
        rounds.append(payload)
        if len(rounds) == 1:
            answer = {'answer': '我查一下。', 'web_search': [{'q': 'Python docs'}]}
        else:
            assert 'Official documentation' in payload['messages'][-1]['content']
            answer = {'answer': '这是 Python 官方文档。[网页1]', 'web_citations': [1]}
        yield from (output_stream if tools else json_stream)(answer)
    monkeypatch.setattr(agent, 'stream_chat', respond)
    chat = client.post(PREFIX + '/conversations').json()
    run = client.post(PREFIX + '/conversations/' + chat['id'] + '/messages', json={'content': '搜索 Python 官方文档', 'idempotency_key': str(uuid.uuid4()), 'web_search_enabled': True}).json()
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed', info
    assert requested == ['Python docs'] and len(rounds) == 2
    data = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()
    assert data['web_sources'][0]['message_id'] == data['messages'][-1]['id']
    assert data['web_sources'][0]['sources'][0]['url'] == 'https://docs.python.org/3/'
    assert other.get(PREFIX + '/conversations/' + chat['id'] + '/messages').status_code == 404
    assert client.get(PREFIX + '/tasks').json() == []
    events = client.get(PREFIX + '/agent-runs/' + run['id'] + '/events').text
    assert 'event: web_search' in events and 'event: web_sources' in events
    assert '"text": "我查一下。"' not in events
    with tenant_session(client.user_id) as db:
        db.add(ForgetRequest(user_id=client.user_id, source_id=data['messages'][1]['id'], state='pending'))
    assert client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()['web_sources'] == []


def test_disabled_search_never_calls_network_and_idempotency_checks_option(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); connection(client)
    monkeypatch.setattr(agent, 'search_web', lambda q: pytest.fail('Disabled network called'))
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: output_stream({'answer': '', 'web_search': [{'q': 'test'}]}))
    chat = client.post(PREFIX + '/conversations').json()
    body = {'content': '你好', 'idempotency_key': str(uuid.uuid4())}
    path = PREFIX + '/conversations/' + chat['id'] + '/messages'
    run = client.post(path, json=body).json()
    assert client.post(path, json={**body, 'web_search_enabled': True}).status_code == 409
    agent.execute_agent(client.user_id, run['id'])
    assert client.get(PREFIX + '/agent-runs/' + run['id']).json()['status'] == 'failed'


def test_search_requests_cannot_carry_writes_or_unbounded_queries():
    for fields in ({'q': ' '}, {'q': 'x' * 201}, {'q': 'test', 'url': 'http://localhost'}):
        with pytest.raises(ValidationError):
            AgentOutput.model_validate({'answer': '', 'web_search': [fields]})
    with pytest.raises(ValidationError):
        AgentOutput.model_validate({'answer': '', 'web_search': [{'q': 'test'}], 'actions': [{'kind': 'create', 'fields': {'title': 'unrequested'}}]})


def start_search(client, content='搜索 Python 官方文档'):
    chat = client.post(PREFIX + '/conversations').json()
    response = client.post(PREFIX + '/conversations/' + chat['id'] + '/messages', json={
        'content': content, 'idempotency_key': str(uuid.uuid4()), 'web_search_enabled': True})
    assert response.status_code == 202, response.text
    return chat, response.json()


def test_cancel_during_search_does_not_publish_sources(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); connection(client)
    chat, run = start_search(client)
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: output_stream({'answer': '', 'web_search': [{'q': 'Python docs'}]}))
    def cancel(q):
        assert client.post(PREFIX + '/agent-runs/' + run['id'] + '/cancel').status_code == 200
        return [{'title': 'Must not publish', 'url': 'https://python.org/'}]
    monkeypatch.setattr(agent, 'search_web', cancel)
    agent.execute_agent(client.user_id, run['id'])
    assert client.get(PREFIX + '/agent-runs/' + run['id']).json()['status'] == 'cancelled'
    data = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()
    assert not data['web_sources'] and len(data['messages']) == 2


def test_empty_results_can_retry_but_search_calls_are_limited(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); connection(client)
    searched = []
    monkeypatch.setattr(agent, 'search_web', lambda q: searched.append(q) or [])
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: output_stream({'answer': '', 'web_search': [{'q': 'another keyword'}]}))
    _, run = start_search(client)
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert len(searched) == 2 and info['status'] == 'failed' and '两次' in info['error']


@pytest.mark.parametrize('failure', ['forged', 'no_results', 'network'])
def test_search_cannot_fabricate_success_or_sources(accounts, monkeypatch, failure):
    import app.agent as agent
    client = accounts(); connection(client)
    _, run = start_search(client)
    calls = []
    def respond(c, p):
        calls.append(True)
        output = {'answer': '', 'web_search': [{'q': 'test'}]} if len(calls) == 1 else {
            'answer': '仅作一般说明。' if failure == 'no_results' else '来自来源。[网页10]',
            'web_citations': [] if failure == 'no_results' else [10]}
        yield from output_stream(output)
    def search(q):
        if failure == 'network':
            raise HTTPException(502, '免费搜索服务暂时不可用')
        return []
    monkeypatch.setattr(agent, 'stream_chat', respond)
    monkeypatch.setattr(agent, 'search_web', search)
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    if failure == 'no_results':
        assert info['status'] == 'completed' and info['answer'].startswith('联网搜索未找到匹配网页')
    else:
        assert info['status'] == 'failed' and info['error']


def test_explicit_search_repairs_old_no_access_reply(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); connection(client)
    _, run = start_search(client)
    outputs = iter([{'answer': '我无法联网，请自己查询。'}, {'answer': '', 'web_search': [{'q': 'Python docs'}]}, {'answer': '请看官方文档。[网页1]', 'web_citations': [1]}])
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: output_stream(next(outputs)))
    monkeypatch.setattr(agent, 'search_web', lambda q: [{'title':'Python docs','url':'https://docs.python.org/3/','snippet':'Docs','site':'docs.python.org','published_at':None}])
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed' and '无法联网' not in info['answer']


def test_enabled_search_is_not_used_for_ordinary_chat(accounts, monkeypatch):
    import app.agent as agent
    client = accounts(); connection(client)
    monkeypatch.setattr(agent, 'search_web', lambda q: pytest.fail('Ordinary chat searched'))
    monkeypatch.setattr(agent, 'stream_chat', lambda c,p: output_stream({'answer': '晚上好，有什么想聊的？'}))
    _, run = start_search(client, '晚上好')
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed' and info['web_search'] is None


@pytest.mark.parametrize('latest,expected', [('今天天气怎么样', False), ('现在能看了吗', True), ('再查一次', True)])
def test_trash_context_follows_current_topic(latest, expected):
    from types import SimpleNamespace
    from app.agent import needs_trash
    messages = [SimpleNamespace(role=role, content=text) for role, text in
        [('user', latest), ('assistant', '垃圾站目前是空的'), ('user', '看看垃圾站')]]
    assert needs_trash(messages) is expected
    if latest == '再查一次':
        messages.insert(1, SimpleNamespace(role='user', content='今天天气怎么样'))
        assert needs_trash(messages) is False


@pytest.mark.parametrize('tools', [True, False])
def test_weather_after_trash_uses_configured_city_and_current_observation(accounts, monkeypatch, tools):
    import app.agent as agent
    from app.common import preferences
    from app.advanced_models import Message
    from app.models import utcnow
    from datetime import timedelta
    client = accounts(); conn = connection(client)
    chat = client.post(PREFIX + '/conversations').json()
    with tenant_session(client.user_id) as db:
        preferences(db, client.user_id).weather_city = '深圳'
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': tools}}
        db.add(Message(user_id=client.user_id, conversation_id=chat['id'], role='assistant',
            content='垃圾站目前是空的，没有任何已删除的任务。', created_at=utcnow()-timedelta(minutes=1)))
    requested = []
    def weather(city, zone):
        requested.append((city, zone))
        return {'city': city, 'current': {'temperature_2m': 28.5, 'weather': '多云', 'time': '2026-10-09T14:30:00+08:00'},
            'source': 'https://www.weather.com.cn/weather1d/101280601.shtml'}
    monkeypatch.setattr(agent, 'load_current_weather', weather, raising=False)
    monkeypatch.setattr(agent, 'search_web', lambda q: pytest.fail('Weather must not use irrelevant generic RSS'))
    def respond(c, payload):
        system = '\n'.join(m['content'] for m in payload['messages'] if m['role'] == 'system')
        assert '系统已为当前垃圾站话题执行只读查询' not in system
        assert '深圳' in system and '28.5' in system and '多云' in system and '14:30' in system
        yield from (output_stream if tools else json_stream)({'answer': '按你设置的深圳查询：当前多云，28.5°C，更新于14:30。[网页1]', 'web_citations': [1]})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    run = client.post(PREFIX + '/conversations/' + chat['id'] + '/messages', json={
        'content': '今天天气怎么样', 'idempotency_key': str(uuid.uuid4()), 'web_search_enabled': True}).json()
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == 'completed', info
    assert requested == [('深圳', 'Asia/Shanghai')]
    data = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()
    assert data['web_sources'][0]['sources'][0]['kind'] == 'weather'
    assert '垃圾站' not in info['answer'] and '上海' not in info['answer']


@pytest.mark.parametrize('question,city', [('今天天气怎么样', '深圳'), ('上海今天天气怎么样？', '上海'),
    ('查一下娄底市今天的天气', '娄底市'), ('请问今天北京的气温多少度', '北京'), ('现在这边天气如何', '深圳'),
    ('明天深圳天气怎么样', None), ('新增一个查天气的任务', None), ('天气预报怎么接入软件', None)])
def test_current_weather_routing_only_reads_requested_city(question, city):
    from app.weather_source import current_weather_city
    assert current_weather_city(question, '深圳') == city


@pytest.mark.parametrize('mode', ['disabled', 'failed', 'cancelled', 'explicit_city'])
def test_weather_network_boundaries_and_city_override(accounts, monkeypatch, mode):
    import app.agent as agent
    from app.common import preferences
    client = accounts(); connection(client)
    with tenant_session(client.user_id) as db:
        preferences(db, client.user_id).weather_city = '深圳'
    chat = client.post(PREFIX + '/conversations').json()
    run = client.post(PREFIX + '/conversations/' + chat['id'] + '/messages', json={
        'content': '上海今天天气怎么样' if mode == 'explicit_city' else '今天天气怎么样',
        'idempotency_key': str(uuid.uuid4()), 'web_search_enabled': mode != 'disabled'}).json()
    def weather(city, zone):
        assert mode != 'disabled'
        assert city == ('上海' if mode == 'explicit_city' else '深圳')
        if mode == 'failed':
            raise HTTPException(502, '天气暂时无法获取')
        if mode == 'cancelled':
            assert client.post(PREFIX + '/agent-runs/' + run['id'] + '/cancel').status_code == 200
        return {'city': city, 'current': {'temperature_2m': 25, 'time': '2026-10-09T14:00:00+08:00'},
            'source': 'https://www.weather.com.cn/weather1d/101020100.shtml'}
    monkeypatch.setattr(agent, 'load_current_weather', weather)
    monkeypatch.setattr(agent, 'search_web', lambda q: pytest.fail('Current weather used generic RSS'))
    def respond(c, payload):
        assert mode != 'cancelled'
        if mode == 'failed':
            assert '天气暂时无法获取' in payload['messages'][-1]['content']
        yield from output_stream({'answer': '请开启联网搜索。' if mode == 'disabled' else '天气暂时无法获取。' if mode == 'failed' else '上海当前25°C。[网页1]'})
    monkeypatch.setattr(agent, 'stream_chat', respond)
    agent.execute_agent(client.user_id, run['id'])
    info = client.get(PREFIX + '/agent-runs/' + run['id']).json()
    assert info['status'] == ('cancelled' if mode == 'cancelled' else 'completed'), info
    data = client.get(PREFIX + '/conversations/' + chat['id'] + '/messages').json()
    assert bool(data['web_sources']) == (mode == 'explicit_city')
    with tenant_session(client.user_id) as db:
        assert preferences(db, client.user_id).weather_city == '深圳'
