"""Read current observations from the public China Weather city pages."""
from datetime import datetime, timedelta
import json
import math
import re
from zoneinfo import ZoneInfo
import httpx
from fastapi import HTTPException
from pypinyin import lazy_pinyin


def current_weather_city(text: str, configured: str) -> str | None:
    """Route simple current-weather questions; other requests stay with the agent."""
    if len(text) > 100 or re.search(r'明天|后天|下周|未来|预报|昨天|历史|任务|提醒|记录|设置|垃圾站|和|以及|、', text):
        return None
    match = re.fullmatch(r'(?P<before>[^\n，,。！？!?；;]{0,60}?)(?:天气|气温|温度)(?:怎么样|怎样|如何|情况|多少度?|好不好|冷不冷|热不热|呢)?[？?。！!\s]*', text.strip())
    if not match:
        return None
    city = re.sub(r'今天|今日|现在|当前|此刻|的', '', match['before']).strip()
    city = re.sub(r'^(?:(?:请|帮我|给我|小狒|告诉我|查一下|查询|搜索|搜一下|看看|查查|查|联网|上网|问一下|问)\s*)+', '', city).strip()
    if city in ('', '这边', '当地', '这里', '我这边'):
        return configured.strip() or None
    if re.fullmatch(r'[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z .-]{0,39}', city):
        return city
    return None


def china_weather(client: httpx.Client, city: str) -> dict | None:
    name = city.removesuffix('市')
    if not re.search(r'[\u4e00-\u9fff]', name):
        return None
    response = client.get('https://toy1.weather.com.cn/search', params={'cityname': name})
    response.raise_for_status()
    match = re.fullmatch(r'\s*\(\s*(\[.*\])\s*\)\s*;?\s*', response.text, re.DOTALL)
    if not match:
        raise ValueError('Invalid city search response')
    station = None
    for item in json.loads(match[1]):
        fields = item.get('ref', '').split('~')
        if len(fields) >= 3 and re.fullmatch(r'101\d{6}', fields[0]) and fields[2].removesuffix('市') == name:
            station = fields[0]
            break
    if station is None:
        return None
    response = client.get(f'https://d1.weather.com.cn/sk_2d/{station}.html', params={})
    response.raise_for_status()
    match = re.fullmatch(r'\s*var\s+dataSK\s*=\s*(\{.*\})\s*;?\s*', response.text, re.DOTALL)
    if not match:
        raise ValueError('Invalid observation response')
    data = json.loads(match[1])
    if data['city'] != station:
        raise ValueError('Observation belongs to another city')
    temperature = float(data['temp'])
    if not math.isfinite(temperature) or not -100 <= temperature <= 65:
        raise ValueError('Invalid temperature')
    # Observation timestamps use China time, independently of the account timezone.
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    day = re.match(r'(\d{1,2})月(\d{1,2})日', data['date'])
    if not day:
        raise ValueError('Missing observation date')
    hour, minute = map(int, data['time'].split(':'))
    dates = []
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            dates.append(datetime(year, int(day[1]), int(day[2]), hour, minute, tzinfo=now.tzinfo))
        except ValueError:
            continue
    if not dates:
        raise ValueError('Invalid observation date')
    observed = min(dates, key=lambda stamp: abs(now - stamp))
    if not -timedelta(minutes=10) <= now - observed <= timedelta(hours=3):
        raise ValueError('Observation is stale')
    return {
        'enabled': True, 'city': city,
        'current': {'temperature_2m': temperature, 'time': observed.isoformat(), 'weather': data.get('weather', '')},
        'source': f'https://www.weather.com.cn/weather1d/{station}.shtml',
    }


def load_current_weather(city: str, timezone: str) -> dict:
    try:
        with httpx.Client(timeout=8, follow_redirects=False, trust_env=False,
                          headers={'User-Agent': 'TodoWorkbenchWeather/1.0', 'Referer': 'https://www.weather.com.cn/'}) as client:
            city = city.strip()
            for attempt in range(2):
                try:
                    observation = china_weather(client, city)
                    if observation is not None:
                        return observation
                    break
                except httpx.HTTPError:
                    # One retry for a transient domestic connection failure.
                    if attempt:
                        break
                except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                    break
            # Overseas geocoding/forecast remains a fallback for other cities.
            fallback = ''.join(lazy_pinyin(city.removesuffix('市')))
            locations = []
            for name in dict.fromkeys((city, fallback)):
                response = client.get('https://geocoding-api.open-meteo.com/v1/search', params={'name': name, 'count': 1, 'language': 'zh'})
                response.raise_for_status()
                locations = response.json().get('results') or []
                if locations:
                    break
            if not locations:
                raise HTTPException(422, f'未找到城市「{city}」，请选择其他城市或检查名称')
            location = locations[0]
            response = client.get('https://api.open-meteo.com/v1/forecast', params={'latitude': location['latitude'], 'longitude': location['longitude'],
                'current': 'temperature_2m,weather_code', 'timezone': timezone})
            response.raise_for_status()
            forecast = response.json()
        return {'enabled': True, 'city': city, 'current': forecast['current'], 'source': 'https://open-meteo.com/'}
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, '天气暂时无法获取，稍后可重试') from None
