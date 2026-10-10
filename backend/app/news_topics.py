"""Explicit interests constrain news selection; they never trigger a general fallback."""
import re
import unicodedata


AI_TERMS = ('AI', '人工智能', '大模型', '机器学习', '深度学习', 'LLM', 'ChatGPT',
            'OpenAI', 'DeepSeek', 'Claude', 'Gemini', 'Anthropic', '智能体')
ALIASES = {
    'ai': AI_TERMS, '人工智能': AI_TERMS,
    '编程': ('编程', '程序开发', '软件开发', 'Python', 'JavaScript', 'TypeScript', '编程语言'),
    '设计': ('设计', '用户体验', 'UX', 'UI'),
}


def normalize_topics(topics):
    result, seen = [], set()
    for topic in topics:
        value = ' '.join(unicodedata.normalize('NFKC', topic).split())
        if not value or len(value) > 40:
            raise ValueError('关注主题须为 1–40 个字符')
        if value.casefold() not in seen:
            result.append(value)
            seen.add(value.casefold())
    if len(result) > 8:
        raise ValueError('最多设置 8 个关注主题')
    return result


def matching_topic(title, description, topics):
    text = unicodedata.normalize('NFKC', title + ' ' + description).casefold()
    for topic in topics:
        terms = ALIASES.get(topic.casefold(), (topic,))
        for term in terms:
            term = term.casefold()
            if re.search('[a-z0-9]', term):
                if re.search(r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])', text):
                    return topic
            elif term in text:
                return topic
    return None
