"""AI may select evidence IDs; only the server supplies source URLs and dates."""
import json
import re
from datetime import datetime, timedelta
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError
from fastapi import HTTPException
from .models import utcnow
from .web_search import safe_source_url

PREFIX = 'AI资讯整理：\n'


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class SearchPlan(Strict):
    queries: list[str] = Field(min_length=1, max_length=4)
    keywords: list[str] = Field(min_length=1, max_length=24)
    source_names: list[str] = Field(default_factory=list, max_length=20)


class DigestItem(Strict):
    source_ids: list[StrictInt] = Field(min_length=1, max_length=3)
    topic: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=1200)
    points: list[str] = Field(default_factory=list, max_length=3)


class Digest(Strict):
    items: list[DigestItem] = Field(max_length=5)


def json_model(answer, schema):
    answer = re.sub(r'^```(?:json)?\s*|\s*```$', '', answer.strip())
    try:
        return schema.model_validate_json(answer)
    except (ValidationError, ValueError):
        raise HTTPException(502, 'AI 资讯整理格式无效，请重新更新') from None


def parse_plan(answer):
    plan = json_model(answer, SearchPlan)
    if any(not q.strip() or len(q) > 120 for q in plan.queries + plan.keywords):
        raise HTTPException(502, 'AI 检索关键词无效，请重新更新')
    return plan


def parse_digest(answer, candidates, topics):
    output = json_model(answer, Digest)
    result, used = [], set()
    for item in output.items:
        if item.topic not in topics or any(i < 1 or i > len(candidates) for i in item.source_ids):
            raise HTTPException(502, 'AI 引用了无效资讯来源或主题，请重新更新')
        if any(len(p) > 400 or not p.strip() for p in item.points) or re.search(r'https?://|www\.', item.title + item.summary + ''.join(item.points), re.I):
            raise HTTPException(502, 'AI 摘要包含无效内容，请重新更新')
        sources = []
        for index in dict.fromkeys(item.source_ids):
            article = candidates[index - 1]
            url = safe_source_url(article['url'])
            if not url:
                raise HTTPException(502, '资讯来源地址无效')
            stamp = article.get('published_at')
            sources.append({'title': article['title'], 'url': url, 'site': article['source'],
                'published_at': stamp.isoformat() if isinstance(stamp, datetime) else None})
        # A source already used in this batch belongs in its existing story.
        if any(s['url'] in used for s in sources):
            continue
        used.update(s['url'] for s in sources)
        result.append({**item.model_dump(exclude={'source_ids'}), 'sources': sources})
    return result


def encode_digest(item):
    return PREFIX + json.dumps(item, ensure_ascii=False)


def decode_digest(reason):
    if not reason.startswith(PREFIX):
        return None
    try:
        item = json.loads(reason[len(PREFIX):])
        if not isinstance(item, dict) or not isinstance(item.get('sources'), list) or not item['sources']:
            return None
        if not all(isinstance(s, dict) and safe_source_url(s.get('url')) for s in item['sources']):
            return None
        if not all(isinstance(item.get(k), str) for k in ('topic', 'title', 'summary')) or not isinstance(item.get('points'), list):
            return None
        return item
    except (ValueError, TypeError):
        return None


def candidates_for_digest(articles, searched, keywords, blocked_sources, seen_urls, preferred_sources=(), topics=()):
    """Bound model context; prefer relevant recent feeds and supplement with search snippets."""
    from .news_topics import matching_topic
    # Generic words otherwise pull unrelated social stories into the model's limited context.
    generic = {'相关', '新闻', '资讯', '进展', '研究', '技术', '政策', '最新', '发展', 'news', 'latest', 'research'}
    specific = [word for word in keywords if word.casefold() not in generic]
    ranked = sorted((a for a in articles if a['source'] in preferred_sources or matching_topic(a['title'], a['text'], specific)),
        key=lambda a: (bool(matching_topic(a['title'], a['text'], topics)),
            bool(matching_topic(a['title'], a['text'], specific)),
            a['source'] in preferred_sources, a.get('published_at') or utcnow() - timedelta(days=7)), reverse=True)
    result, urls = [], set(seen_urls)
    # Search RSS pubDate can be a crawl date, so never label it as publication time.
    search_articles = []
    for r in searched:
        stamp = None
        if r.get('date_kind') == 'published' and r.get('published_at'):
            try:
                stamp = datetime.fromisoformat(r['published_at'])
                if not stamp.tzinfo:
                    stamp = None
            except (TypeError, ValueError):
                pass
        search_articles.append({'title': r['title'], 'url': r['url'], 'source': r['site'],
            'text': r['snippet'], 'published_at': stamp})
    for article, days in [(a, 30) for a in search_articles] + [(a, 30) for a in ranked[:35]]:
        if article['source'] in blocked_sources or article['url'] in urls or not safe_source_url(article['url']):
            continue
        stamp = article.get('published_at')
        if stamp and (stamp < utcnow() - timedelta(days=days) or stamp > utcnow() + timedelta(days=1)):
            continue
        result.append(article)
        urls.add(article['url'])
    return result[:50]
