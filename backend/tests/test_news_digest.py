import json
import pytest
from fastapi import HTTPException
from app.models import User, utcnow
from app.common import tenant_session, today
from app.news_digest import parse_plan, parse_digest, encode_digest, decode_digest, candidates_for_digest
from test_p1_p4 import connection


def source(url='https://example.com/drug'):
    return {'title': '新药获批', 'url': url, 'source': '监管公告', 'text': '药品获批用于指定适应症', 'published_at': utcnow()}


def test_plan_understands_topic_without_requiring_literal_phrase():
    plan = parse_plan(json.dumps({'queries': ['新药', 'clinical trials'], 'keywords': ['药品', '临床研究']}))
    assert plan.queries == ['新药', 'clinical trials']
    with pytest.raises(HTTPException):
        parse_plan('{"queries":[],"keywords":[]}')


def test_digest_resolves_only_real_sources_and_retains_semantic_topic():
    body = json.dumps({'items': [{'source_ids': [1], 'topic': '医药相关', 'title': '新药研发进展', 'summary': '监管部门公布药品批准信息。', 'points': ['仅针对公告中的适应症。']}]})
    rows = parse_digest(body, [source()], ['医药相关'])
    assert rows[0]['sources'][0]['url'] == 'https://example.com/drug'
    assert decode_digest(encode_digest(rows[0])) == rows[0]
    for change in [{'source_ids': [99]}, {'source_ids': [True]}, {'topic': '体育'}, {'url': 'https://invented.example/foo'}, {'summary': '见 https://invented.example/foo'}]:
        data = json.loads(body)
        data['items'][0].update(change)
        with pytest.raises(HTTPException):
            parse_digest(json.dumps(data), [source()], ['医药相关'])


def test_digest_merges_sources_and_rejects_unsafe_evidence():
    item = {'source_ids': [1, 2], 'topic': '医药相关', 'title': '临床进展', 'summary': '两篇报道讨论同一项研究。', 'points': []}
    rows = parse_digest(json.dumps({'items': [item]}), [source(), source('https://other.example/trial')], ['医药相关'])
    assert len(rows[0]['sources']) == 2
    with pytest.raises(HTTPException):
        parse_digest(json.dumps({'items': [item]}), [source('javascript:alert(1)'), source()], ['医药相关'])
    assert decode_digest('旧资讯正文') is None
    assert decode_digest('AI资讯整理：\ninvalid') is None


def test_candidates_do_not_fill_with_unrelated_feed_articles_or_generic_words():
    relevant = source()
    unrelated = {**source('https://example.com/art'), 'title': '艺术教育研究进展', 'text': '学校举办艺术节'}
    result = candidates_for_digest([unrelated, relevant], [], ['药品', '研究', '进展'], set(), set())
    assert [r['url'] for r in result] == [relevant['url']]
    clinical = {**source('https://example.com/clinical'), 'source': '健康栏目', 'title': '肿瘤早筛进展', 'text': '临床创新与精准诊断'}
    result = candidates_for_digest([unrelated, clinical], [], ['药品审批'], set(), set(), {'健康栏目'})
    assert [r['url'] for r in result] == [clinical['url']]


def test_search_publication_date_has_thirty_day_window_and_crawl_date_is_not_publication():
    from datetime import timedelta
    rows = [
        {'title': 'DeepSeek release', 'url': 'https://example.com/release', 'site': 'example.com',
         'snippet': 'Release details', 'published_at': (utcnow()-timedelta(days=12)).isoformat(), 'date_kind': 'published'},
        {'title': 'Old release', 'url': 'https://example.com/old', 'site': 'example.com',
         'snippet': 'Older event', 'published_at': (utcnow()-timedelta(days=31)).isoformat(), 'date_kind': 'published'},
        {'title': 'RSS result', 'url': 'https://example.com/crawl', 'site': 'example.com',
         'snippet': 'RSS crawl date', 'published_at': utcnow().isoformat()},
    ]
    result = candidates_for_digest([], rows, ['DeepSeek'], set(), set())
    assert [r['url'] for r in result] == ['https://example.com/release', 'https://example.com/crawl']
    assert result[0]['published_at'] is not None and result[1]['published_at'] is None


def test_specific_interest_is_not_crowded_out_by_a_busy_technology_feed():
    from datetime import timedelta
    busy = [{**source(f'https://example.com/other/{i}'), 'title': f'AI 手机新品 {i}',
        'text': 'AI 手机新品', 'source': '科技栏目'} for i in range(45)]
    relevant = {**source('https://example.com/deepseek'), 'title': 'DeepSeek 研究新进展',
        'text': '公布模型研究', 'source': 'AI 栏目', 'published_at': utcnow()-timedelta(hours=8)}
    rows = candidates_for_digest(busy+[relevant], [], ['DeepSeek', 'AI'], set(), set(),
        {'科技栏目', 'AI 栏目'}, ['deepseek'])
    assert rows[0]['url'] == relevant['url'] and len(rows) == 35


def test_legacy_zero_news_status_does_not_claim_there_is_no_news(accounts):
    from app.advanced_models import Job
    client = accounts()
    job = client.post('/api/v1/recommendations/refresh?kind=news').json()
    with tenant_session(client.user_id) as db:
        row = db.get(Job, job['id'])
        row.state = 'completed'
        row.payload = {**row.payload, 'ai_news': True, 'result': {'count': 0,
            'message': '本次没有新的相关资讯；已过滤重复报道及证据不足的内容。'}}
    status = client.get('/api/v1/recommendations/news-status').json()
    assert status['outcome'] == 'insufficient_sources'
    assert '无法判断' in status['message']


def test_ai_news_search_summary_sources_and_settings_isolation(accounts, monkeypatch):
    import app.recommendations as rec
    from cryptography.fernet import Fernet
    from app.config import settings
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())
    client, other = accounts(), accounts()
    connection(client)
    pref = client.get('/api/v1/settings').json()
    saved = client.put('/api/v1/news-topics', json={'version': pref['version'], 'topics': ['医药相关']}).json()
    with tenant_session(client.user_id) as db:
        day = str(today(db.get(User, client.user_id)))
    monkeypatch.setattr(rec, 'collect_articles', lambda: [])
    queries = []
    def search(query):
        queries.append(query)
        return [{'title': '新药临床试验结果', 'url': 'https://example.com/trial', 'site': 'example.com', 'snippet': '公开研究报告了新药的临床试验结果。', 'published_at': utcnow().isoformat()}]
    monkeypatch.setattr(rec, 'search_web', search)
    def model(conn, request):
        assert 'tools' not in request
        if 'queries' in request['messages'][0]['content']:
            output = {'queries': ['新药临床试验'], 'keywords': ['新药', '临床']}
        else:
            output = {'items': [{'source_ids': [1], 'topic': '医药相关', 'title': '临床研究公布新进展', 'summary': '公开研究报告了试验结果，结论限于研究范围。', 'points': ['详细结果请查看原始来源。']}]}
        yield {'choices': [{'delta': {'content': json.dumps(output, ensure_ascii=False)}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 50, 'completion_tokens': 30}}
    monkeypatch.setattr(rec, 'stream_chat', model)
    result = rec.generate_recommendations(client.user_id, 'news', {'date': day, 'settings_version': saved['version'], 'ai_news': True})
    assert result['count'] == 1 and queries == ['医药相关', '新药临床试验']
    news = client.get('/api/v1/recommendations?kind=news').json()
    assert len(news) == 1 and news[0]['ai_curated']
    assert news[0]['summary'] in news[0]['reason'] and 'AI资讯整理：' not in news[0]['reason']
    assert news[0]['sources'][0]['url'] == 'https://example.com/trial'
    assert news[0]['sources'][0]['published_at'] is None  # Search RSS date is not an article publication date.
    assert other.get('/api/v1/recommendations?kind=news').json() == []
    client.put('/api/v1/news-topics', json={'version': saved['version'], 'topics': ['体育']})
    assert client.get('/api/v1/recommendations?kind=news').json() == []


def test_unfamiliar_name_is_searched_before_model_expands_its_meaning(accounts, monkeypatch):
    import app.recommendations as rec
    client = accounts()
    connection(client)
    pref = client.get('/api/v1/settings').json()
    saved = client.put('/api/v1/news-topics', json={'version': pref['version'], 'topics': ['jev']}).json()
    with tenant_session(client.user_id) as db:
        day = str(today(db.get(User, client.user_id)))
    events = []
    evidence = {'title': 'Introducing System One Models & Jev', 'url': 'https://typesafe.ai/blog/introducing-system-one-models-and-jev',
        'site': 'typesafe.ai', 'snippet': 'TypeSafe AI releases Jev, a model for structured decisions.', 'published_at': None}
    def search(query):
        events.append(('search', query))
        return [evidence]
    def model(conn, request):
        data = json.loads(request['messages'][-1]['content'])
        if 'queries' in request['messages'][0]['content']:
            assert events[0] == ('search', 'jev')
            assert data['discovery_sources'][0]['site'] == 'typesafe.ai'
            assert 'structured decisions' in data['discovery_sources'][0]['snippet']
            events.append(('plan', None))
            output = {'queries': ['jev', 'Jev TypeSafe AI'], 'keywords': ['Jev', 'TypeSafe']}
        else:
            output = {'items': [{'source_ids': [1], 'topic': 'jev', 'title': 'TypeSafe 发布 Jev 决策模型',
                'summary': '官方公告介绍了用于结构化决策的 Jev 模型。', 'points': []}]}
        yield {'choices': [{'delta': {'content': json.dumps(output)}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 50, 'completion_tokens': 30}}
    monkeypatch.setattr(rec, 'search_web', search)
    monkeypatch.setattr(rec, 'collect_articles', lambda: [])
    monkeypatch.setattr(rec, 'stream_chat', model)
    result = rec.generate_recommendations(client.user_id, 'news', {'date': day, 'settings_version': saved['version'], 'ai_news': True})
    assert result['count'] == 1
    assert events == [('search', 'jev'), ('plan', None), ('search', 'Jev TypeSafe AI')]
    news = client.get('/api/v1/recommendations?kind=news').json()
    assert len(news) == 1 and news[0]['sources'][0]['url'] == evidence['url']


def test_exa_outage_still_publishes_ai_digest_from_free_feed(accounts, monkeypatch):
    import app.recommendations as rec
    client = accounts()
    connection(client)
    pref = client.get('/api/v1/settings').json()
    saved = client.put('/api/v1/news-topics', json={'version': pref['version'], 'topics': ['deepseek']}).json()
    with tenant_session(client.user_id) as db:
        day = str(today(db.get(User, client.user_id)))
    article = {**source('https://example.com/deepseek-research'), 'title': 'DeepSeek 模型研究进展',
        'text': '研究讨论了输入位置对模型回答的影响。', 'source': 'AI 栏目'}
    monkeypatch.setattr(rec, 'collect_articles', lambda: [article])
    def unavailable(query):
        raise HTTPException(502, '免费 Exa 搜索暂不可用')
    monkeypatch.setattr(rec, 'search_web', unavailable)
    def model(uid, payload, binding, instruction, data, max_tokens):
        if 'queries' in instruction:
            return json.dumps({'queries': ['DeepSeek news'], 'keywords': ['DeepSeek']})
        assert data['sources'][0]['title'] == article['title']
        return json.dumps({'items': [{'source_ids': [1], 'topic': 'deepseek',
            'title': article['title'], 'summary': article['text'], 'points': []}]})
    monkeypatch.setattr(rec, 'news_model', model)
    result = rec.generate_recommendations(client.user_id, 'news',
        {'date': day, 'settings_version': saved['version'], 'ai_news': True})
    assert result['count'] == 1 and result['outcome'] == 'updated'
    assert '部分检索暂不可用' in result['message']
    rows = client.get('/api/v1/recommendations?kind=news').json()
    assert rows[0]['ai_curated'] and rows[0]['sources'][0]['url'] == article['url']


def test_manual_refresh_can_retry_completed_job_and_reports_result(accounts):
    from datetime import timedelta
    from app.advanced_models import Job
    client = accounts()
    first = client.post('/api/v1/recommendations/refresh?kind=news').json()
    assert client.post('/api/v1/recommendations/refresh?kind=news').json()['id'] == first['id']
    with tenant_session(client.user_id) as db:
        job = db.get(Job, first['id'])
        job.state = 'completed'
        job.available_at = utcnow() - timedelta(minutes=2)
        job.payload = {**job.payload, 'result': {'count': 0, 'message': '没有找到可核实的相关资讯'}}
    status = client.get('/api/v1/recommendations/news-status').json()
    assert status['state'] == 'completed' and status['message'] == '没有找到可核实的相关资讯'
    second = client.post('/api/v1/recommendations/refresh?kind=news').json()
    assert second['id'] != first['id']
    assert accounts().get('/api/v1/recommendations/news-status').json() is None


def test_worker_reports_missing_model_and_saves_success_result(accounts, monkeypatch):
    import app.worker as worker
    from app.advanced_models import Job
    from datetime import timedelta
    client = accounts()
    job = client.post('/api/v1/recommendations/refresh?kind=news').json()
    worker.process_job(client.user_id, job['id'])
    status = client.get('/api/v1/recommendations/news-status').json()
    assert status['state'] == 'failed' and '连接模型' in status['message']
    with tenant_session(client.user_id) as db:
        db.get(Job, job['id']).available_at = utcnow() - timedelta(minutes=2)
    job = client.post('/api/v1/recommendations/refresh?kind=news').json()
    monkeypatch.setattr(worker, 'generate_recommendations', lambda *args: {'count': 2, 'message': 'AI 已整理 2 条资讯'})
    worker.process_job(client.user_id, job['id'])
    status = client.get('/api/v1/recommendations/news-status').json()
    assert status['state'] == 'completed' and status['count'] == 2


def test_grouped_secondary_sources_are_seen_on_later_updates(accounts):
    from app.advanced_models import Recommendation
    from app.recommendations import seen_news_urls
    from datetime import timedelta
    client = accounts()
    item = {'topic': '医药相关', 'title': '临床研究', 'summary': '两处报道同一事件。', 'points': [], 'sources': [
        {'title': '原始报告', 'url': 'https://example.com/one', 'site': '研究机构', 'published_at': None},
        {'title': '后续报道', 'url': 'https://example.com/two', 'site': '媒体', 'published_at': None}]}
    with tenant_session(client.user_id) as db:
        db.add(Recommendation(user_id=client.user_id, kind='news', topic=item['topic'], title=item['title'],
            reason=encode_digest(item), url=item['sources'][0]['url'], source='研究机构',
            local_date=today(db.get(User, client.user_id)), expires_at=utcnow()+timedelta(days=1)))
    with tenant_session(client.user_id) as db:
        assert seen_news_urls(db, client.user_id) == {'https://example.com/one', 'https://example.com/two'}
