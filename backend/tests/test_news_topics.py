from datetime import timedelta
import pytest
from app.news_topics import normalize_topics, matching_topic
from app.recommendations import select_news
from app.common import tenant_session, today, preferences
from app.models import User, utcnow
from app.advanced_models import Recommendation


def article(title, text='', category='科技'):
    return {'title':title,'text':text,'url':'https://example.com/'+title,'source':'测试来源',
            'published_at':utcnow(),'general_topic':category}


@pytest.mark.parametrize('title,text', [('AI 新进展',''),('人工智能研究',''),('DeepSeek 发布更新',''),('新一代模型','OpenAI 发布 LLM')])
def test_ai_synonyms_match(title,text):
    assert matching_topic(title,text,['AI'])=='AI'


@pytest.mark.parametrize('title', ['Paid training explained','Chair design','公交线路更新','软件版本发布'])
def test_ai_does_not_match_substrings_or_unrelated_news(title):
    assert matching_topic(title,'',['AI']) is None


def test_topics_normalize_and_validate():
    assert normalize_topics([' ＡＩ ','ai','  机器人   技术  '])==['AI','机器人 技术']
    for values in [[' '],['x'*41],list('123456789')]:
        with pytest.raises(ValueError):normalize_topics(values)


def test_explicit_topics_never_fill_with_general_news_and_keep_feedback():
    stories=[article('AI 模型新进展'),article('公交线路更新',category='社会'),article('音乐文化展览',category='文化')]
    assert [a['title'] for _,a in select_news(stories,['AI'],set(),set(),set(),set(),strict_topics=True)]==['AI 模型新进展']
    assert select_news(stories[1:],['AI'],set(),set(),set(),set(),strict_topics=True)==[]
    assert select_news(stories,['AI'],{'AI'},set(),set(),set(),strict_topics=True)==[]
    assert select_news(stories,['AI'],set(),{'测试来源'},set(),set(),strict_topics=True)==[]
    assert select_news(stories,['AI'],set(),set(),set(),{stories[0]['url']},strict_topics=True)==[]


def test_topic_settings_persist_are_isolated_and_preserved_by_old_clients(accounts):
    one,two=accounts(),accounts()
    pref=one.get('/api/v1/settings').json()
    assert pref['news_topics']==[]
    saved=one.put('/api/v1/news-topics',json={'version':pref['version'],'topics':[' AI ','ai']})
    assert saved.status_code==200
    assert saved.json()['news_topics']==['AI']
    assert saved.json()['context_version']==pref['context_version']
    assert two.get('/api/v1/settings').json()['news_topics']==[]
    assert one.put('/api/v1/news-topics',json={'version':pref['version'],'topics':['设计']}).status_code==409
    assert one.put('/api/v1/news-topics',json={'version':saved.json()['version'],'topics':[' ']}).status_code==422
    # Legacy clients only know the original setting fields.
    keys=('version','timezone','memory_enabled','followups_enabled','news_enabled','suggestions_enabled','notifications_enabled','weather_enabled','weather_city','theme','work_start','work_end','recommendation_time','daily_capacity','daily_call_limit','daily_token_limit')
    legacy={k:saved.json()[k] for k in keys}
    legacy['daily_capacity']=100
    assert one.put('/api/v1/settings',json=legacy).json()['news_topics']==['AI']
    latest=one.get('/api/v1/settings').json()
    assert one.put('/api/v1/news-topics',json={'version':latest['version'],'topics':[]}).json()['news_topics']==[]


def test_generation_overrides_task_interests_and_hides_old_unrelated_articles(accounts,monkeypatch):
    import app.recommendations as rec
    client=accounts()
    assert client.post('/api/v1/tasks',json={'title':'Python 软件开发','scope':'work','due_date':None,'due_at':None}).status_code==201
    pref=client.get('/api/v1/settings').json()
    with tenant_session(client.user_id) as db:
        day=today(db.get(User,client.user_id))
        for title,topic,reason in [('城市公交更新','通用资讯·社会','通用资讯 · 社会\n城市交通服务'),('无关旧文章','AI','与当前明确兴趣或工作主题相关：AI\n公交线路变化')]:
            db.add(Recommendation(user_id=client.user_id,kind='news',title=title,topic=topic,reason=reason,source='旧来源',local_date=day,expires_at=utcnow()+timedelta(days=1)))
    saved=client.put('/api/v1/news-topics',json={'version':pref['version'],'topics':['AI']}).json()
    assert client.get('/api/v1/recommendations?kind=news').json()==[]
    stories=[article('人工智能模型新发布'),article('Python 新版本'),article('城市交通政策',category='社会')]
    monkeypatch.setattr(rec,'collect_articles',lambda:stories)
    rec.generate_recommendations(client.user_id,'news',{'date':str(day),'settings_version':saved['version']})
    items=client.get('/api/v1/recommendations?kind=news').json()
    assert [r['title'] for r in items]==['人工智能模型新发布']
    assert items[0]['topic']=='AI'
    assert client.post('/api/v1/recommendations/'+items[0]['id']+'/feedback',json={'action':'bookmark'}).status_code==200
    changed=client.put('/api/v1/news-topics',json={'version':saved['version'],'topics':['Python']}).json()
    assert client.get('/api/v1/recommendations?kind=news').json()==[]
    def stale_collect():raise AssertionError('An outdated job must not collect or summarize articles')
    monkeypatch.setattr(rec,'collect_articles',stale_collect)
    rec.generate_recommendations(client.user_id,'news',{'date':str(day),'settings_version':saved['version']})
    assert changed['news_topics']==['Python']


def test_topic_change_cancels_old_queued_jobs(accounts):
    client=accounts()
    pref=client.get('/api/v1/settings').json()
    assert client.post('/api/v1/recommendations/refresh?kind=news').status_code==200
    assert client.put('/api/v1/news-topics',json={'version':pref['version'],'topics':['AI']}).status_code==200
    jobs=client.get('/api/v1/jobs').json()
    assert [j['state'] for j in jobs if j['kind']=='news']==['cancelled']
