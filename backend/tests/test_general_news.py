from datetime import timedelta

from app.recommendations import select_news
from app.models import User, utcnow
from app.common import tenant_session, today


def article(title, source='综合来源', category='社会与生活', age=0):
    return {'title':title, 'text':title, 'url':'https://example.com/'+title,
        'source':source, 'published_at':utcnow()-timedelta(days=age), 'general_topic':category}


def select(articles, topics=(), blocked_topics=(), blocked_sources=(), less=(), seen=()):
    return select_news(articles, topics, set(blocked_topics), set(blocked_sources), set(less), set(seen))


def test_no_memory_still_gets_general_news_and_no_unmarked_fallback():
    items=select([article('城市公共交通'),article('天文观测进展','科技来源','科技'),article('无关技术日志',category=None)])
    assert len(items)==2
    assert all(topic.startswith('通用资讯·') for topic, _ in items)


def test_personal_matches_leave_two_general_slots_and_fill_five():
    articles=[article('Python 数据分析', '博客甲', None),article('Python 异步编程', '博客乙', None),
        article('Python 包管理', '博客丙', None),article('Python 测试框架', '博客丁', None),
        article('城市公共交通', '社会来源'),article('电影文化展览', '文化来源', '文化')]
    selected=select(articles,['Python'])
    assert len(selected)==5
    assert [topic for topic,_ in selected[:3]]==['Python']*3
    assert sum(topic.startswith('通用资讯·') for topic,_ in selected)==2


def test_general_categories_and_sources_are_diverse():
    selected=select([article('公交线路更新'),article('城市住房政策'),article('社区活动安排'),
        article('太阳观测进展','科技来源','科技',1),article('古典音乐展览','文化来源','文化',2)])
    assert [topic for topic,_ in selected[:2]]==['通用资讯·社会与生活','通用资讯·科技']
    assert len(selected)==4


def test_blocks_seen_and_less_feedback_apply_to_general_news():
    society=article('城市交通建设')
    science=article('天文观测成果','科学来源','科技')
    culture=article('音乐文化展览','文化来源','文化',1)
    assert select([society],blocked_topics=['通用资讯·社会与生活'])==[]
    assert select([society],blocked_sources=['综合来源'])==[]
    assert select([society],seen=[society['url']])==[]
    selected=select([society,science,culture],less=['通用资讯·社会与生活'])
    assert selected[0][1]['source']=='科学来源'


def test_duplicate_title_and_url_across_pools_only_publish_once():
    first=article('Python 开发新版本','科技来源','科技')
    duplicate={**first,'url':first['url']+'-copy','source':'另一来源'}
    selected=select([first,dict(first),duplicate],['Python'])
    assert len(selected)==1


def test_blocked_personal_topic_is_not_reintroduced_as_general():
    assert select([article('Python 最新进展',category='科技')],['Python'],blocked_topics=['Python'])==[]


def test_empty_sources_produce_no_recommendations():
    assert select([])==[]


def test_feed_fetch_accepts_monthly_reports_and_keeps_publication_dates(monkeypatch):
    import httpx
    from email.utils import format_datetime
    import app.recommendations as rec
    real_client = httpx.Client
    recent = utcnow()-timedelta(days=14)
    old = utcnow()-timedelta(days=31)
    body = ('<rss><channel>' + ''.join(
        f'<item><title>DeepSeek {name}</title><link>https://example.com/{name}</link>'
        f'<description>研究摘要</description><pubDate>{format_datetime(stamp)}</pubDate></item>'
        for name,stamp in [('recent',recent),('old',old)]) + '</channel></rss>').encode()
    def respond(request):
        assert request.headers['user-agent'] == 'Mozilla/5.0'
        assert 'authorization' not in request.headers
        return httpx.Response(200,content=body)
    monkeypatch.setattr(rec,'public_https',lambda url:True)
    monkeypatch.setattr(rec.httpx,'Client',lambda **kwargs:real_client(**kwargs,transport=httpx.MockTransport(respond)))
    rows=rec.fetch_feed({'url':'https://example.com/feed','name':'测试来源','enabled':True})
    assert len(rows)==1 and rows[0]['url']=='https://example.com/recent'
    assert abs((rows[0]['published_at']-recent).total_seconds())<1


def test_cached_articles_keep_general_category(monkeypatch):
    import uuid
    import os
    from sqlalchemy import create_engine, delete
    from sqlalchemy.engine import make_url
    import app.recommendations as rec
    from app.advanced_models import ArticleSource, Article
    source_url='https://example.com/feed/'+uuid.uuid4().hex
    monkeypatch.setattr(rec,'source_list',lambda:[{'name':'生活来源','url':source_url,'enabled':True,'general_topic':'生活'}])
    with rec.SessionFactory() as db, db.begin():
        source=ArticleSource(name='生活来源',url=source_url,fetched_at=utcnow(),enabled=True)
        db.add(source)
        db.flush()
        source_id=source.id
        db.add(Article(source_id=source.id,title='生活服务更新',url=source_url+'/story',text='城市生活',fingerprint='test',published_at=utcnow()))
    try:
        def no_fetch(url):
            raise AssertionError('Fresh feeds must use cached articles')
        monkeypatch.setattr(rec,'public_https',no_fetch)
        articles=rec.collect_articles()
        assert len(articles)==1
        assert articles[0]['general_topic']=='生活'
        assert select(articles)[0][0]=='通用资讯·生活'
    finally:
        # Runtime can collect feeds, but only the test DB owner may remove shared sources.
        owner_url=os.environ['TEST_MIGRATION_DATABASE_URL']
        assert make_url(owner_url).database.endswith('_test')
        owner=create_engine(owner_url,hide_parameters=True)
        try:
            with owner.begin() as db:
                db.execute(delete(ArticleSource).where(ArticleSource.id==source_id))
        finally:
            owner.dispose()


def test_general_news_published_without_memory_and_preserves_feedback(accounts,monkeypatch):
    import app.recommendations as rec
    client=accounts()
    pref=client.get('/api/v1/settings').json()
    with tenant_session(client.user_id) as db:
        payload={'date':str(today(db.get(User,client.user_id))),'settings_version':pref['version']}
    story=article('城市公共交通更新')
    monkeypatch.setattr(rec,'collect_articles',lambda:[story])
    rec.generate_recommendations(client.user_id,'news',payload)
    items=client.get('/api/v1/recommendations').json()
    assert len(items)==1
    assert items[0]['topic']=='通用资讯·社会与生活'
    assert items[0]['reason'].startswith('通用资讯 · 社会与生活')
    assert items[0]['url']==story['url']
    assert client.post('/api/v1/recommendations/'+items[0]['id']+'/feedback',json={'action':'block_topic'}).status_code==200
    story['url']+='-new'
    rec.generate_recommendations(client.user_id,'news',payload)
    assert len(client.get('/api/v1/recommendations').json())==1
    assert client.get('/api/v1/tasks').json()==[]
