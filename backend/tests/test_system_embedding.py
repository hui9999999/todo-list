import json
import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from app.config import settings
from app.common import tenant_session
from app.advanced_models import EmbeddingProfile, SearchChunk, UsageEvent


@pytest.fixture
def system_service(monkeypatch):
    config = settings()
    monkeypatch.setattr(config, 'system_embedding_api_key', SecretStr('system-test-secret'))
    monkeypatch.setattr(config, 'system_embedding_model', 'qwen3.7-text-embedding')
    monkeypatch.setattr(config, 'system_embedding_dimensions', 1024)
    return config


def test_automatic_system_index_is_private_and_incremental(accounts, monkeypatch, system_service):
    import app.memory as memory
    import app.worker as worker
    a, b = accounts(), accounts()
    a.post('/api/v1/tasks', json={'title': '买牛奶和水果'})
    b.post('/api/v1/tasks', json={'title': '其他账户的私密事项'})
    calls = []
    def batch(conn, model, texts):
        calls.append(texts)
        return [[1.] + [0.] * 1023 for text in texts]
    monkeypatch.setattr(worker, 'embedding_batch', batch)
    monkeypatch.setattr(memory, 'embedding', lambda *args: [1.] + [0.] * 1023)
    status = a.get('/api/v1/embedding-service').json()
    assert status['configured'] and status['managed'] and status['state'] == 'building'
    assert status['model'] == 'qwen3.7-text-embedding'
    assert 'system-test-secret' not in json.dumps(status)
    assert a.get('/api/v1/provider-connections').json() == []
    assert a.post('/api/v1/model-preferences', json={}).status_code in (404, 405)
    profile = a.get('/api/v1/embedding-profiles').json()[0]
    assert profile['connection_id'] is None
    worker.index_profile(a.user_id, profile['id'])
    result = a.get('/api/v1/history/search?q=采购食品').json()
    assert result['mode'] == 'hybrid'
    assert [hit['title'] for hit in result['hits']] == ['买牛奶和水果']
    assert b.get('/api/v1/history/search?q=采购食品').json()['hits'] == []
    worker.index_profile(a.user_id, profile['id'])
    assert len(calls) == 1
    a.post('/api/v1/tasks', json={'title': '补充日用品'})
    worker.index_profile(a.user_id, profile['id'])
    assert len(calls) == 2 and calls[-1] == ['补充日用品\n']
    assert len(a.get('/api/v1/embedding-profiles').json()) == 1
    with tenant_session(a.user_id) as db:
        assert len(list(db.scalars(select(SearchChunk)))) == 2
        assert len(list(db.scalars(select(UsageEvent).where(UsageEvent.purpose == 'embedding')))) == 2
    # No shared connection ID can be selected for chat or queried across tenants.
    assert a.put('/api/v1/model-preferences', json={'connection_id': profile['id'], 'model': status['model'], 'thinking': 'auto'}).status_code == 404


def test_system_embedding_protocol_and_secret_not_returned(accounts, monkeypatch, system_service):
    import app.memory as memory
    import app.providers as providers
    from app.embedding_service import system_connection
    original_client = httpx.Client
    def handler(request):
        assert str(request.url) == 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
        assert request.headers['authorization'] == 'Bearer system-test-secret'
        body = json.loads(request.content)
        assert body['model'] == 'qwen3.7-text-embedding'
        assert body['dimensions'] == 1024 and body['encoding_format'] == 'float'
        if len(body['input']) == 2:
            return httpx.Response(200, json={'data': [{'index': 1, 'embedding': [0., 1.]}, {'index': 0, 'embedding': [1., 0.]}]})
        return httpx.Response(200, json={'data': [{'index': 0, 'embedding': [1., 0.]}]})
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    connection = system_connection()
    assert 'system-test-secret' not in repr(connection)
    assert memory.embedding(connection, system_service.system_embedding_model, '食品') == [1., 0.]
    assert memory.embedding_batch(connection, system_service.system_embedding_model, ['牛奶', '水果']) == [[1., 0.], [0., 1.]]


def test_unavailable_system_service_falls_back_without_user_setup(accounts, monkeypatch, system_service):
    import app.memory as memory
    import app.worker as worker
    from fastapi import HTTPException
    a = accounts()
    a.post('/api/v1/tasks', json={'title': '客户汇报'})
    profile = a.get('/api/v1/embedding-profiles').json()[0]
    monkeypatch.setattr(worker, 'embedding_batch', lambda *args: [[1.] + [0.] * 1023])
    worker.index_profile(a.user_id, profile['id'])
    monkeypatch.setattr(memory, 'embedding', lambda *args: (_ for _ in ()).throw(HTTPException(502, 'offline')))
    result = a.get('/api/v1/history/search?q=汇报').json()
    assert result['mode'] == 'keyword' and result['hits']
    assert '降级' in result['index_status']
    assert a.get('/api/v1/provider-connections').json() == []


def test_system_budget_blocks_queries_before_provider_call(accounts, monkeypatch, system_service):
    import app.memory as memory
    from test_p1_p4 import settings_body
    a = accounts()
    a.post('/api/v1/tasks', json={'title': '预算测试'})
    profile = a.get('/api/v1/embedding-profiles').json()[0]
    with tenant_session(a.user_id) as db:
        db.get(EmbeddingProfile, profile['id']).state = 'ready'
    assert a.put('/api/v1/settings', json=settings_body(a, daily_call_limit=0)).status_code == 200
    monkeypatch.setattr(memory, 'embedding', lambda *args: pytest.fail('Budget must reject before a paid request'))
    result = a.get('/api/v1/history/search?q=预算').json()
    assert result['mode'] == 'keyword' and result['hits']


def test_failed_system_dimension_does_not_publish_chunks(accounts, monkeypatch, system_service):
    import app.worker as worker
    from fastapi import HTTPException
    a = accounts()
    a.post('/api/v1/tasks', json={'title': '维度校验'})
    profile = a.get('/api/v1/embedding-profiles').json()[0]
    monkeypatch.setattr(worker, 'embedding_batch', lambda *args: [[1., 0.]])
    with pytest.raises(HTTPException):
        worker.index_profile(a.user_id, profile['id'])
    with tenant_session(a.user_id) as db:
        assert db.get(EmbeddingProfile, profile['id']).state == 'failed'
        assert list(db.scalars(select(SearchChunk))) == []
