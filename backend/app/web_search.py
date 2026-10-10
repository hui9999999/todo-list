"""Bounded public search; retrieved content is untrusted evidence."""
from html.parser import HTMLParser
import ipaddress
import re
import time
import json
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
import httpx
from httpx import Client
from fastapi import HTTPException
from sqlalchemy import select
from .advanced_models import AgentRun, RunEvent, Message, ForgetRequest

SEARCH_URL = 'https://cn.bing.com/search'
MAX_BYTES = 131072
EXA_URL = 'https://mcp.exa.ai/mcp?tools=web_search_advanced_exa'
_exa_retry_after = 0.0


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.blocked = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.blocked += 1
        elif tag in ('br', 'p', 'div', 'li'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.blocked = max(0, self.blocked - 1)
        elif tag in ('p', 'div', 'li'):
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.blocked:
            self.parts.append(data)


def plain(value, limit):
    parser = PlainText()
    parser.feed(value or '')
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()[:limit]


def safe_source_url(value):
    if not isinstance(value, str) or len(value) > 2000 or re.search(r'[\x00-\x20\\]', value):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower().rstrip('.')
        if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            return None
        if not host or '.' not in host or host.endswith(('.local', '.internal', '.localhost', '.test')) or host == 'localhost':
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            if not re.fullmatch(r'[a-z0-9.-]+', host) or re.fullmatch(r'[\d.]+', host) or host.startswith(('0x', '0X')):
                return None
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ''))
    except ValueError:
        return None


def parse_results(body):
    if len(body) > MAX_BYTES or re.search(br'<!\s*(?:DOCTYPE|ENTITY)', body, re.I):
        raise ValueError('Invalid RSS size or declarations')
    root = ET.fromstring(body)
    if root.tag != 'rss' or root.find('channel') is None:
        raise ValueError('Not RSS search results')
    sources, seen = [], set()
    for item in root.findall('./channel/item'):
        url = safe_source_url(item.findtext('link', ''))
        title = plain(item.findtext('title'), 300)
        if not url or not title or url in seen:
            continue
        published = None
        try:
            timestamp = parsedate_to_datetime(item.findtext('pubDate', ''))
            if timestamp.tzinfo:
                published = timestamp.isoformat()
        except (ValueError, TypeError, OverflowError):
            pass
        sources.append({'title': title, 'url': url, 'snippet': plain(item.findtext('description'), 800),
            'site': urlsplit(url).hostname, 'published_at': published})
        seen.add(url)
        if len(sources) == 5:
            break
    return sources


def search_web(query):
    return search_rss(query)


def search_news(query):
    """News about new names often needs the international index, not a guessed expansion."""
    from .config import settings
    if settings().news_search_provider == 'free':
        return search_exa(query)
    if settings().news_search_provider == 'bocha':
        return search_bocha(query)
    try:
        results = search_rss(query, {'mkt': 'en-US', 'cc': 'US'})
        if results:
            return results
    except HTTPException:
        pass
    return search_web(query)


def search_exa(query):
    """Use only Exa's keyless, rate-limited MCP mode; never attach credentials."""
    global _exa_retry_after
    if time.monotonic() < _exa_retry_after:
        raise HTTPException(502, '免费 Exa 搜索暂不可用，本次仅使用已取得的订阅来源')
    now = datetime.now(timezone.utc)
    request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {
        'name': 'web_search_advanced_exa', 'arguments': {'query': query, 'numResults': 8,
            'type': 'auto', 'category': 'news', 'textMaxCharacters': 1200,
            'startPublishedDate': (now-timedelta(days=30)).date().isoformat(),
            'endPublishedDate': (now+timedelta(days=1)).date().isoformat()}}}
    deadline = time.monotonic() + 25
    try:
        with Client(timeout=httpx.Timeout(20, connect=3), follow_redirects=False, trust_env=False) as client:
            with client.stream('POST', EXA_URL, json=request,
                    headers={'Accept': 'application/json, text/event-stream'}) as response:
                if response.status_code == 429:
                    _exa_retry_after = time.monotonic() + 60
                    raise HTTPException(429, '免费 Exa 搜索已限流，本次仅使用已取得的订阅来源')
                if response.status_code != 200:
                    raise ValueError('Search unavailable')
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=4096):
                    body.extend(chunk)
                    if len(body) > MAX_BYTES or time.monotonic() > deadline:
                        raise ValueError('Search response exceeded limits')
                return parse_exa(bytes(body))
    except (httpx.HTTPError, ValueError, RecursionError):
        # Avoid retrying a blocked network for every query in the same update.
        _exa_retry_after = time.monotonic() + 60
        raise HTTPException(502, '免费 Exa 搜索暂不可用，本次仅使用已取得的订阅来源') from None


def parse_exa(body):
    """Parse the MCP envelope and the advanced tool's structured JSON content."""
    if len(body) > MAX_BYTES:
        raise ValueError('Search response exceeded limits')
    raw = body.decode('utf-8')
    if raw.lstrip().startswith('{'):
        messages = [json.loads(raw)]
    else:
        messages = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith('data:')]
    envelope = next((item for item in messages if isinstance(item, dict) and item.get('id') == 1), None)
    if not envelope or envelope.get('error') or not isinstance(envelope.get('result'), dict):
        raise ValueError('Invalid search envelope')
    result = envelope['result']
    if result.get('isError') or not isinstance(result.get('content'), list):
        raise ValueError('Search tool failed')
    rows = None
    for block in result['content'][:10]:
        if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str):
            payload = json.loads(block['text'])
            if isinstance(payload, dict) and isinstance(payload.get('results'), list):
                rows = payload['results']
                break
    if rows is None:
        raise ValueError('Missing search results')
    sources, seen = [], set()
    for row in rows[:50]:
        if not isinstance(row, dict):
            continue
        url = safe_source_url(row.get('url'))
        title = plain(row.get('title') if isinstance(row.get('title'), str) else '', 300)
        if not url or not title or url in seen:
            continue
        stamp = None
        try:
            date = datetime.fromisoformat(row.get('publishedDate', '').replace('Z', '+00:00'))
            if date.tzinfo:
                stamp = date.isoformat()
        except (TypeError, ValueError, AttributeError):
            pass
        content = row.get('text')
        if not isinstance(content, str):
            highlights = row.get('highlights')
            content = ' '.join(x for x in highlights[:3] if isinstance(x, str)) if isinstance(highlights, list) else ''
        sources.append({'title': title, 'url': url, 'site': urlsplit(url).hostname,
            'snippet': plain(content, 1200), 'published_at': stamp, 'date_kind': 'published'})
        seen.add(url)
        if len(sources) == 8:
            break
    return sources


def search_bocha(query):
    """Explicit opt-in search service. Never send model credentials to a search provider."""
    from .config import settings
    config = settings()
    key = config.bocha_search_api_key.get_secret_value().strip()
    if not key and config.bocha_search_key_file:
        try:
            key = Path(config.bocha_search_key_file).read_text(encoding='utf-8-sig').strip()
        except OSError:
            raise HTTPException(409, '资讯搜索密钥文件不可读，请管理员检查配置') from None
    if not key or len(key) > 2000 or any(c.isspace() for c in key):
        raise HTTPException(409, '资讯搜索服务尚未配置有效密钥，请管理员完成配置')
    deadline = time.monotonic() + 15
    try:
        with Client(timeout=httpx.Timeout(8, connect=5), follow_redirects=False, trust_env=False) as client:
            with client.stream('POST', 'https://api.bochaai.com/v1/web-search',
                    json={'query': query, 'freshness': 'oneMonth', 'summary': True, 'count': 10},
                    headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}) as response:
                if response.status_code in (401, 403):
                    raise HTTPException(409, '资讯搜索密钥无效或无权限，请管理员检查配置')
                if response.status_code == 429:
                    raise HTTPException(429, '资讯搜索服务限流或额度不足，请稍后重试')
                if response.status_code != 200:
                    raise HTTPException(502, '资讯搜索服务暂时不可用，请稍后重试')
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=4096):
                    body.extend(chunk)
                    if len(body) > MAX_BYTES or time.monotonic() > deadline:
                        raise ValueError('Search response exceeded limits')
                return parse_bocha(bytes(body))
    except (httpx.HTTPError, ValueError, RecursionError):
        raise HTTPException(502, '资讯检索未成功，服务超时或返回格式无效，请稍后重试') from None


def parse_bocha(body):
    if len(body) > MAX_BYTES:
        raise ValueError('Search response exceeded limits')
    data = json.loads(body)
    if not isinstance(data, dict) or data.get('code') not in (None, 200, '200'):
        raise ValueError('Invalid search response')
    data = data.get('data', data)
    if not isinstance(data, dict) or not isinstance(data.get('webPages'), dict):
        raise ValueError('Missing search results')
    rows = data['webPages'].get('value')
    if not isinstance(rows, list):
        raise ValueError('Invalid search results')
    result, seen = [], set()
    for row in rows[:50]:
        if not isinstance(row, dict):
            continue
        url = safe_source_url(row.get('url'))
        title = plain(row.get('name') if isinstance(row.get('name'), str) else '', 300)
        if not url or not title or url in seen:
            continue
        stamp = None
        try:
            parsed = datetime.fromisoformat(row.get('datePublished', '').replace('Z', '+00:00'))
            if parsed.tzinfo:
                stamp = parsed.isoformat()
        except (ValueError, TypeError, AttributeError):
            pass
        snippet = row.get('summary') or row.get('snippet') or ''
        result.append({'title': title, 'url': url, 'site': urlsplit(url).hostname,
            'snippet': plain(snippet if isinstance(snippet, str) else '', 1200),
            'published_at': stamp, 'date_kind': 'published'})
        seen.add(url)
        if len(result) == 10:
            break
    return result


def search_rss(query, market=None):
    deadline = time.monotonic() + 15
    try:
        with Client(timeout=httpx.Timeout(5, connect=5), follow_redirects=False, trust_env=False) as client:
            with client.stream('GET', SEARCH_URL, params={'q': query, 'format': 'rss', **(market or {})},
                    headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml'}) as response:
                if response.status_code == 429:
                    raise HTTPException(429, '免费搜索服务暂时限流，请稍后重试')
                if response.status_code != 200:
                    raise HTTPException(502, '免费搜索服务暂时不可用，请稍后重试')
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=4096):
                    body.extend(chunk)
                    if len(body) > MAX_BYTES or time.monotonic() > deadline:
                        raise ValueError('Search response exceeded limits')
                return parse_results(bytes(body))
    except (httpx.HTTPError, ValueError, ET.ParseError):
        raise HTTPException(502, '联网搜索未成功，服务超时或返回格式无效，请稍后重试') from None


def conversation_sources(db, user, conversation_id):
    forgotten = db.scalar(select(Message.id).where(Message.user_id == user.id, Message.conversation_id == conversation_id,
        Message.id.in_(select(ForgetRequest.source_id).where(ForgetRequest.user_id == user.id))).limit(1))
    if forgotten:
        return []
    return [event.payload for event in db.scalars(select(RunEvent).join(AgentRun,
        (AgentRun.id == RunEvent.run_id) & (AgentRun.user_id == RunEvent.user_id)).where(
        RunEvent.user_id == user.id, AgentRun.conversation_id == conversation_id,
        RunEvent.kind == 'web_sources').order_by(RunEvent.sequence))]


def search_progress(db, user_id, run_id):
    event = db.scalar(select(RunEvent).where(RunEvent.user_id == user_id, RunEvent.run_id == run_id,
        RunEvent.kind == 'web_search').order_by(RunEvent.sequence.desc()).limit(1))
    return event.payload if event else None
