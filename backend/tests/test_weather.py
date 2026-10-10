import json
from datetime import datetime
from zoneinfo import ZoneInfo
import httpx
import pytest
from app import experience
from app.common import tenant_session, preferences


def configure(client, city, enabled=True):
    with tenant_session(client.user_id) as db:
        pref=preferences(db,client.user_id)
        pref.weather_city=city
        pref.weather_enabled=enabled


@pytest.mark.parametrize('city,query', [('娄底','loudi'), ('娄底市','loudi'), ('重庆','chongqing')])
def test_chinese_city_falls_back_to_pinyin(accounts,monkeypatch,city,query):
    client=accounts();configure(client,city);queries=[]
    class Upstream:
        def __init__(self,**kwargs): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def get(self,url,params):
            if 'weather.com.cn' in url:
                raise httpx.ConnectError('Domestic upstream unavailable')
            if 'geocoding' in url:
                queries.append(params['name'])
                body={'results':[{'name':'Loudi','latitude':27.73,'longitude':111.99}]} if params['name']==query else {}
            else:
                assert params['latitude']==27.73
                body={'current':{'temperature_2m':23.5,'weather_code':1}}
            return httpx.Response(200,json=body,request=httpx.Request('GET',url))
    monkeypatch.setattr(experience.httpx,'Client',Upstream)
    result=client.get('/api/v1/weather')
    assert result.status_code==200,result.text
    assert result.json()['city']==city
    assert result.json()['current']['temperature_2m']==23.5
    assert queries==[city,query]


def test_disabled_unknown_city_and_upstream_errors(accounts,monkeypatch):
    client=accounts();configure(client,'不存在的城市',False);calls=[]
    class Upstream:
        status=200
        def __init__(self,**kwargs): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def get(self,url,params):
            calls.append(url)
            if 'weather.com.cn' in url:
                raise httpx.ConnectError('Domestic upstream unavailable')
            return httpx.Response(self.status,json={},request=httpx.Request('GET',url))
    monkeypatch.setattr(experience.httpx,'Client',Upstream)
    assert client.get('/api/v1/weather').json()=={'enabled':False}
    assert calls==[]
    configure(client,'不存在的城市')
    result=client.get('/api/v1/weather')
    assert result.status_code==422 and '未找到城市' in result.json()['detail']
    Upstream.status=503
    result=client.get('/api/v1/weather')
    assert result.status_code==502 and '天气暂时无法获取' in result.json()['detail']


@pytest.mark.parametrize('city', ['娄底', '娄底市'])
def test_weather_works_when_overseas_network_is_unreachable(accounts,monkeypatch,city):
    client=accounts();configure(client,city);calls=[]
    now=datetime.now(ZoneInfo('Asia/Shanghai'))
    class Upstream:
        def __init__(self,**kwargs): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def get(self,url,params):
            calls.append(url)
            if 'toy1.weather.com.cn' in url:
                assert params['cityname']=='娄底'
                # Similar results must not replace the exact requested city.
                body='('+json.dumps([{'ref':'101090220004~hebei~南娄底乡~Nanloudi'}, {'ref':'101250801~hunan~娄底~Loudi'}])+')'
            elif 'd1.weather.com.cn' in url:
                assert url.endswith('/101250801.html')
                body='var dataSK='+json.dumps({'city':'101250801','cityname':'娄底','temp':'26.9','weather':'晴','date':now.strftime('%m月%d日')+'(星期四)','time':now.strftime('%H:%M')})+';'
            else:
                raise httpx.ConnectError('Network is unreachable')
            return httpx.Response(200,text=body,request=httpx.Request('GET',url))
    monkeypatch.setattr(experience.httpx,'Client',Upstream)
    result=client.get('/api/v1/weather')
    assert result.status_code==200,result.text
    assert result.json()['city']==city
    assert result.json()['current']['temperature_2m']==26.9
    assert result.json()['source']=='https://www.weather.com.cn/weather1d/101250801.shtml'
    assert len(calls)==2


@pytest.mark.parametrize('override', [{'temp':'NaN'}, {'temp':'999'}, {'date':'01月01日(星期四)'}, {'city':'101251001'}, {'temp':''}])
def test_invalid_domestic_observation_uses_backup(accounts,monkeypatch,override):
    client=accounts();configure(client,'娄底')
    now=datetime.now(ZoneInfo('Asia/Shanghai'))
    class Upstream:
        def __init__(self,**kwargs): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def get(self,url,params):
            if 'toy1.weather.com.cn' in url:
                body='([{"ref":"101250801~hunan~娄底~Loudi"}])'
            elif 'd1.weather.com.cn' in url:
                observation={'city':'101250801','temp':'26.9','date':now.strftime('%m月%d日'),'time':now.strftime('%H:%M'),**override}
                body='var dataSK='+json.dumps(observation)
            elif 'geocoding' in url:
                return httpx.Response(200,json={'results':[{'latitude':27.73,'longitude':111.99}]},request=httpx.Request('GET',url))
            else:
                return httpx.Response(200,json={'current':{'temperature_2m':23.5,'weather_code':1}},request=httpx.Request('GET',url))
            return httpx.Response(200,text=body,request=httpx.Request('GET',url))
    monkeypatch.setattr(experience.httpx,'Client',Upstream)
    result=client.get('/api/v1/weather')
    assert result.status_code==200,result.text
    assert result.json()['current']['temperature_2m']==23.5
    assert result.json()['source']=='https://open-meteo.com/'


def test_transient_domestic_connection_retries_before_unreachable_overseas(monkeypatch):
    from app import weather_source
    now=datetime.now(ZoneInfo('Asia/Shanghai'))
    calls=[]
    real=httpx.Client
    def respond(request):
        calls.append(str(request.url))
        if len(calls)==1:
            raise httpx.ConnectTimeout('Transient connection failure')
        if request.url.host=='toy1.weather.com.cn':
            return httpx.Response(200,text='([{"ref":"101280601~guangdong~深圳~Shenzhen"}])')
        assert request.url.host=='d1.weather.com.cn'
        return httpx.Response(200,text='var dataSK='+json.dumps({'city':'101280601','temp':'29.6','weather':'晴','date':now.strftime('%m月%d日'),'time':now.strftime('%H:%M')}))
    monkeypatch.setattr(weather_source.httpx,'Client',lambda **kwargs: real(**kwargs,transport=httpx.MockTransport(respond)))
    result=weather_source.load_current_weather('深圳','Asia/Shanghai')
    assert result['current']['temperature_2m']==29.6
    assert len(calls)==3 and all('weather.com.cn' in url for url in calls)
