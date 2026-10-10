"""Evidence-aware private context. Revocation is a hard filter, never a score."""
import math
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from .auth import current_user
from .db import database
from .models import User, Task, TaskEvent, TaskSnapshot, utcnow
from .advanced_models import Memory, ForgetRequest, Message, AgentRun, RunEvent, EmbeddingProfile, SearchChunk, ProviderConnection, DeletionMarker, ActionProposal, Recommendation
from .ai_schemas import MemoryInput, EmbeddingInput
from .schemas import VersionRequest
from .common import preferences, private_owned, serialize, enqueue, tenant_session
from .providers import request_json
from .embedding_service import initialized_system_profile, system_configured, profile_connection
from .config import settings

router = APIRouter()


def memory_state(row, now=None):
    now = now or utcnow()
    if row.state in ('candidate', 'revoked', 'superseded'):
        return row.state, row.strength
    if row.valid_to and row.valid_to <= now:
        return 'expired', 0
    strength = row.strength if row.pinned or row.source_kind == 'explicit' else row.strength * 2 ** (-max(0, (now - row.evidence_at).total_seconds()) / (86400 * row.half_life_days))
    return ('dormant' if strength < .2 else 'fading' if strength < .5 else 'active'), strength


def context_memories(db, user_id, scope='all'):
    pref = preferences(db, user_id)
    if not pref.memory_enabled:
        return []
    blocked = set(db.scalars(select(ForgetRequest.source_id).where(ForgetRequest.user_id == user_id)))
    result = []
    for row in db.scalars(select(Memory).where(Memory.user_id == user_id)):
        state, strength = memory_state(row)
        if row.source_message_id in blocked or state not in ('active', 'fading') or (row.valid_from and row.valid_from > utcnow()):
            continue
        if scope != 'all' and row.scope not in ('all', scope):
            continue
        result.append({**serialize(row), 'effective_strength': strength})
    # Temporary constraints overlay the same scope/key without permanently replacing preferences.
    result.sort(key=lambda m: (m['kind'] == 'constraint' and bool(m['valid_to']), m['pinned'], m['effective_strength']), reverse=True)
    selected, used = [], set()
    for item in result:
        key = (item['scope'], item['key'])
        if key not in used:
            selected.append(item)
            used.add(key)
    return selected[:30]


@router.get('/memories')
def list_memories(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [{**serialize(row), 'effective_state': memory_state(row)[0], 'effective_strength': memory_state(row)[1]}
        for row in db.scalars(select(Memory).where(Memory.user_id == user.id, Memory.state != 'revoked').order_by(Memory.evidence_at.desc()))]


@router.post('/memories', status_code=201)
def add_memory(body: MemoryInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    pref = preferences(db, user.id, True)
    # A dated constraint overlays its key. Permanent updates replace the previous version.
    if not body.valid_to:
        for old in db.scalars(select(Memory).where(Memory.user_id == user.id, Memory.key == body.key, Memory.scope == body.scope, Memory.state.in_(('active', 'fading')))):
            old.state, old.version = 'superseded', old.version + 1
    row = Memory(user_id=user.id, **body.model_dump())
    db.add(row)
    pref.context_version += 1
    db.flush()
    return serialize(row)


@router.post('/memories/{identifier}/pin')
def pin_memory(identifier: str, body: VersionRequest, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    pref = preferences(db, user.id, True)
    row = private_owned(db, Memory, user.id, identifier, True)
    if row.version != body.version or row.state in ('revoked', 'superseded'):
        raise HTTPException(409, '记忆已变化或失效')
    row.pinned = not row.pinned
    row.state, row.confidence, row.strength = 'active', 1, 1
    row.source_kind, row.evidence_at = 'confirmed', utcnow()
    row.version += 1
    pref.context_version += 1
    return serialize(row)


def revoke(db, user_id, row):
    pref = preferences(db, user_id, True)
    row.state, row.content = 'revoked', ''
    row.version += 1
    source_id = row.source_message_id or row.id
    db.add(DeletionMarker(user_id=user_id, scope='memory', source_id=row.id))
    if row.source_message_id:
        db.add(DeletionMarker(user_id=user_id, scope='message', source_id=row.source_message_id))
    request = ForgetRequest(user_id=user_id, source_id=source_id)
    db.add(request)
    db.flush()
    if row.source_message_id:
        message = db.scalar(select(Message).where(Message.user_id == user_id, Message.id == row.source_message_id))
        if message:
            message.content = '[已遗忘来源]'
            message.attachments = []
        # Existing derived candidate memories share this source and are immediately revoked.
        for other in db.scalars(select(Memory).where(Memory.user_id == user_id, Memory.source_message_id == row.source_message_id)):
            other.content, other.state = '', 'revoked'
    pref.context_version += 1
    enqueue(db, user_id, 'forget', 'forget:' + request.id, {'request_id': request.id, 'source_id': source_id})
    return request


@router.post('/memories/{identifier}/forget')
def forget_memory(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    preferences(db, user.id, True)
    row = private_owned(db, Memory, user.id, identifier, True)
    if row.state == 'revoked':
        return {'state': 'completed'}
    return serialize(revoke(db, user.id, row))


@router.get('/forget-requests/{identifier}')
def forget_status(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return serialize(private_owned(db, ForgetRequest, user.id, identifier))


def cleanup_forget(db, user_id, request_id):
    row = private_owned(db, ForgetRequest, user_id, request_id, True)
    message = db.scalar(select(Message).where(Message.user_id == user_id, Message.id == row.source_id))
    if message:
        message.attachments = []
        # The conversation is derived from a forgotten source. Strip assistant context, event payloads and answers.
        runs = list(db.scalars(select(AgentRun).where(AgentRun.user_id == user_id, AgentRun.conversation_id == message.conversation_id)))
        ids = [r.id for r in runs]
        for run in runs:
            run.answer, run.clarification = '', None
            if run.status not in ('completed', 'failed', 'cancelled'):
                run.status = 'cancelled'
        db.execute(delete(RunEvent).where(RunEvent.user_id == user_id, RunEvent.run_id.in_(ids)))
        for msg in db.scalars(select(Message).where(Message.user_id == user_id, Message.conversation_id == message.conversation_id, Message.role == 'assistant')):
            msg.content = '[来源已遗忘，派生回答已清理]'
    # These generated explanations can quote private preferences. Facts in real tasks stay intact.
    for proposal in db.scalars(select(ActionProposal).where(ActionProposal.user_id == user_id)):
        proposal.reason = ''
        if proposal.state == 'pending':
            proposal.actions, proposal.before, proposal.state = [], [], 'expired'
    for recommendation in db.scalars(select(Recommendation).where(Recommendation.user_id == user_id)):
        recommendation.reason, recommendation.topic = '', ''
        if recommendation.state == 'pending':
            recommendation.state = 'expired'
    row.state = 'completed'


def grams(value):
    value = re.sub(r'[^\w\u4e00-\u9fff]', '', value.lower())
    return {value[i:i+2] for i in range(len(value)-1)} or {value}


def history_window(query, timezone):
    now = utcnow().astimezone(ZoneInfo(timezone))
    numbers = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
    match = re.search(r'(过去|最近)?([一二两三四五六七八九十]|\d{1,2})个月(前)?', query)
    start, end = None, None
    if match:
        count = int(match[2]) if match[2].isdigit() else numbers[match[2]]
        if match[3]:
            start = (now + relativedelta(months=-count)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = start + relativedelta(months=1)
        else:
            start, end = now + relativedelta(months=-count), now
    elif '上个月' in query:
        end = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start = end + relativedelta(months=-1)
    elif '去年' in query:
        start = now.replace(year=now.year-1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start + relativedelta(years=1)
    topic = re.sub(r'(过去|最近)?([一二两三四五六七八九十]|\d{1,2})个月(前)?|上个月|去年|有没有|是否|做过|类似的|帮我|查询|以前|事情|任务', '', query)
    return topic.strip(' ？?'), start, end


def search_history(db, user_id, query, start=None, end=None, scope='all', limit=20):
    stmt = select(TaskEvent, TaskSnapshot).join(TaskSnapshot, TaskSnapshot.event_id == TaskEvent.id).join(Task, Task.id == TaskEvent.task_id).where(
        TaskEvent.user_id == user_id, Task.deleted_at.is_(None))
    if start:
        stmt = stmt.where(TaskEvent.occurred_at >= start)
    if end:
        stmt = stmt.where(TaskEvent.occurred_at < end)
    if scope != 'all':
        stmt = stmt.where(TaskSnapshot.after['scope'].astext == scope)
    candidates = []
    qgrams = grams(query)
    for event, snapshot in db.execute(stmt.order_by(TaskEvent.occurred_at.desc(), TaskEvent.id).limit(5000)):
        text = snapshot.after.get('title', '') + ' ' + snapshot.after.get('notes', '')
        overlap = len(qgrams & grams(text)) / max(1, len(qgrams))
        if not query.strip() or overlap > .1 or query.lower() in text.lower():
            completed = (event.kind == 'imported_completion' or (event.kind in ('created', 'status_changed') and snapshot.after.get('status') == 'done' and (not snapshot.before or snapshot.before.get('status') != 'done')))
            candidates.append({'event_id': event.id, 'task_id': event.task_id, 'title': snapshot.after.get('title'),
                'snapshot': snapshot.after, 'kind': event.kind, 'occurred_at': event.occurred_at.isoformat(),
                'completed': completed and bool(snapshot.after.get('completed_at')), 'completed_at': snapshot.after.get('completed_at') if completed else None, 'score': overlap,
                'reason': '当时记录的标题或备注关键词匹配', 'source': '/tasks/' + event.task_id + '/events'})
    candidates.sort(key=lambda item: (item['score'], item['completed'], item['occurred_at']), reverse=True)
    return candidates[:limit]


def embedding_batch(connection, model, texts):
    if not texts:
        return []
    payload = {'model': model, 'input': [text[:8000] for text in texts], 'encoding_format': 'float'}
    if getattr(connection, 'managed', False):
        payload['dimensions'] = connection.dimensions
    data = request_json(connection, '/embeddings', payload)
    rows = data.get('data') if isinstance(data, dict) else None
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise HTTPException(502, '向量响应格式无效')
    vectors = [None] * len(texts)
    for row in rows:
        index = row.get('index', 0) if isinstance(row, dict) else None
        vector = row.get('embedding') if isinstance(row, dict) else None
        if (not isinstance(index, int) or not 0 <= index < len(texts) or vectors[index] is not None or
            not isinstance(vector, list) or not vector or len(vector) > 8192 or
            not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector)):
            raise HTTPException(502, '向量响应格式无效')
        vectors[index] = vector
    return vectors


def embedding(connection, model, text):
    return embedding_batch(connection, model, [text])[0]


def tracked_embedding(user, connection, model, text, purpose):
    from .agent import reserve_usage
    from .advanced_models import UsageEvent
    with tenant_session(user.id) as meter:
        row = reserve_usage(meter, meter.get(User,user.id), connection, model, 'embedding', purpose, len(text[:8000])+1)
        identifier = row.id
    try:
        return embedding(connection, model, text)
    finally:
        with tenant_session(user.id) as meter:
            row = meter.scalar(select(UsageEvent).where(UsageEvent.user_id == user.id, UsageEvent.id == identifier))
            if row:
                row.state = 'unknown'


@router.post('/embedding-profiles', status_code=201)
def add_profile(body: EmbeddingInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    connection = private_owned(db, ProviderConnection, user.id, body.connection_id)
    vector = tracked_embedding(user, connection, body.model, '模型维度验证', 'embedding-test')
    preferences(db, user.id, True)
    db.refresh(connection)
    if not connection.enabled:
        raise HTTPException(409, '连接在测试期间已停用')
    row = EmbeddingProfile(user_id=user.id, connection_id=connection.id, model=body.model, dimensions=len(vector))
    db.add(row)
    db.flush()
    enqueue(db, user.id, 'embedding', 'embedding:' + row.id, {'profile_id': row.id})
    return serialize(row)


@router.get('/embedding-profiles')
def profiles(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    initialized_system_profile(user.id)
    return [serialize(p) for p in db.scalars(select(EmbeddingProfile).where(EmbeddingProfile.user_id == user.id))]


@router.get('/embedding-service')
def embedding_service(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    profile = initialized_system_profile(user.id)
    return {'managed': True, 'configured': system_configured(), 'model': settings().system_embedding_model,
        'state': profile.state if profile else 'unconfigured'}


@router.get('/history/search')
def history_search(q: str = Query(default='', max_length=500), start: datetime | None = None, end: datetime | None = None,
    scope: str = 'all', semantic: bool = True, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=50),
    user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    if scope not in ('all', 'work', 'life', 'study', 'unassigned') or any(v and v.tzinfo is None for v in (start, end)) or (start and end and start >= end):
        raise HTTPException(422, '无效范围；时间须含偏移，结束晚于开始')
    results = search_history(db, user.id, q, start, end, scope, 5000)
    mode, status = 'keyword', '未配置向量；按事件快照关键词查询，最多检查近期 5000 条事件'
    default_profile = initialized_system_profile(user.id)
    if default_profile:
        status = '历史搜索正在准备，暂用关键词查询' if default_profile.state == 'building' else '按历史快照关键词查询'
    profile = default_profile if default_profile and default_profile.state == 'ready' else db.scalar(select(EmbeddingProfile).where(
        EmbeddingProfile.user_id == user.id, EmbeddingProfile.active, EmbeddingProfile.state == 'ready').limit(1))
    if semantic and profile and q:
        try:
            connection = profile_connection(db, user.id, profile)
            vector = tracked_embedding(user, connection, profile.model, q, 'embedding-query')
            if len(vector) != profile.dimensions:
                raise HTTPException(502, '向量维度变化，请新建配置')
            stmt = select(SearchChunk, TaskEvent, TaskSnapshot).join(TaskEvent, TaskEvent.id == SearchChunk.event_id).join(TaskSnapshot, TaskSnapshot.event_id == TaskEvent.id).join(Task, Task.id == TaskEvent.task_id).where(
                SearchChunk.user_id == user.id, SearchChunk.profile_id == profile.id, Task.deleted_at.is_(None))
            if start:
                stmt = stmt.where(TaskEvent.occurred_at >= start)
            if end:
                stmt = stmt.where(TaskEvent.occurred_at < end)
            if scope != 'all':
                stmt = stmt.where(TaskSnapshot.after['scope'].astext == scope)
            # Exact scan within a profile keeps all dimensions and tenant/time filters before ranking.
            rows = db.execute(stmt.order_by(SearchChunk.embedding.cosine_distance(vector)).limit(20))
            seen = {r['event_id'] for r in results}
            for chunk, event, snap in rows:
                if event.id not in seen:
                    results.append({'event_id': event.id, 'task_id': event.task_id, 'title': snap.after['title'], 'snapshot': snap.after,
                        'kind': event.kind, 'occurred_at': event.occurred_at.isoformat(), 'completed': event.kind in ('created','status_changed','imported_completion') and snap.after.get('status') == 'done' and bool(snap.after.get('completed_at')),
                        'reason': '同配置向量相似；请核对原始事件', 'source': '/tasks/' + event.task_id + '/events', 'score': 0})
            mode, status = 'hybrid', '同用户、同配置精确检索；索引更新由后台处理'
        except HTTPException:
            status = '向量服务不可用，已降级到关键词'
    offset = (page - 1) * page_size
    return {'hits': results[offset:offset + page_size], 'total': len(results), 'page': page, 'page_size': page_size,
        'mode': mode, 'index_status': status, 'scope': scope, 'start': start, 'end': end,
        'message': '' if results else '在该范围内未找到记录；旧版可能缺少完整执行历史'}
