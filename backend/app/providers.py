"""Bounded OpenAI-compatible adapters; keys never leave these preset hosts."""
import json
import asyncio
import time
import base64
import io
import secrets
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
import httpx
from cryptography.fernet import Fernet, InvalidToken
from .auth import current_user
from .config import settings
from .db import database
from .models import User
from .advanced_models import ProviderConnection, ModelPreference, EmbeddingProfile, SearchChunk
from .ai_schemas import ConnectionInput, ModelInput, PreferenceInput
from .common import private_owned, serialize, preferences, tenant_session
from PIL import Image, ImageDraw

router = APIRouter()
STREAM_MAX_SECONDS = 180
ENDPOINTS = {
    ('deepseek', 'cn'): 'https://api.deepseek.com',
    ('bailian', 'cn'): 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ('bailian', 'sg'): 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    ('bailian', 'us'): 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
}
DOCUMENTED_THINKING = {
    'deepseek': {'deepseek-flash': 'toggle', 'deepseek-v4-pro': 'toggle'},
    'bailian': {
        'qwen3.8-max': 'toggle', 'qwen3.8-flash': 'toggle', 'qwen3.7-max': 'toggle',
        'qwen3.7-plus': 'toggle', 'qwen3.7-flash': 'toggle', 'qwen3.6-plus': 'toggle',
        'qwen3.6-flash': 'toggle', 'qwen3.5-plus': 'toggle', 'qwen3.5-flash': 'toggle',
        'qwen3-max': 'toggle', 'qwen-plus': 'toggle', 'qwen-plus-latest': 'toggle',
        'qwen-flash': 'toggle', 'qwen-turbo': 'toggle', 'deepseek-v4.1-flash': 'toggle',
        'deepseek-v4-pro': 'toggle', 'deepseek-v4-flash': 'toggle',
        'qwq-plus': 'only', 'deepseek-r1': 'only', 'deepseek-r1-0528': 'only',
    },
}


def cipher():
    key = settings().credential_master_key
    if not key:
        path = Path(settings().credential_key_file)
        if not path.exists():
            raise HTTPException(503, '凭据主密钥未配置，请运行本地启动脚本或配置 CREDENTIAL_MASTER_KEY')
        key = path.read_text().strip()
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, '凭据主密钥配置无效') from None


def key_of(connection):
    if not connection.enabled:
        raise HTTPException(409, '模型连接已停用')
    try:
        return cipher().decrypt(connection.ciphertext.encode()).decode()
    except InvalidToken:
        raise HTTPException(503, '凭据无法解密，请检查主密钥备份') from None


def endpoint(connection):
    url = ENDPOINTS.get((connection.provider, connection.region))
    if not url:
        raise HTTPException(422, '厂商与地域组合无效')
    return url


def provider_error(status):
    if status in (401, 403):
        return HTTPException(502, 'Key 无效或模型权限不足')
    if status == 429:
        return HTTPException(429, '厂商限流或额度不足，请稍后重试')
    return HTTPException(502, '模型服务不可用或参数不受支持，请检查模型配置')


def request_json(connection, path, payload=None, params=None, catalog_url=None):
    try:
        with httpx.Client(timeout=60, follow_redirects=False, trust_env=False) as client:
            response = client.request('GET' if payload is None else 'POST', catalog_url or endpoint(connection) + path,
                headers={'Authorization': 'Bearer ' + key_of(connection)}, json=payload, params=params)
            if response.status_code >= 300:
                raise provider_error(response.status_code)
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, '模型网络连接失败或响应格式无效') from None


def catalogue_endpoint(connection):
    if connection.provider == 'deepseek':
        return endpoint(connection) + '/models'
    if connection.region == 'sg':
        return 'https://dashscope-intl.aliyuncs.com/api/v1/models'
    if not connection.workspace_id:
        raise HTTPException(422, '百炼此地域的目录需要业务空间 ID；也可手动输入模型 ID 并测试')
    import re
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', connection.workspace_id):
        raise HTTPException(422, '业务空间 ID 无效')
    region = {'cn':'cn-beijing','us':'us-east-1'}[connection.region]
    return f'https://{connection.workspace_id}.{region}.maas.aliyuncs.com/api/v1/models'


def mode_payload(connection, model, requested, content):
    cap = connection.capabilities.get(model, {})
    mode = requested
    reason = '按用户选择'
    if mode == 'auto':
        mode = 'deep' if len(content) > 300 or any(w in content for w in ('比较', '冲突', '拆解', '规划', '依赖')) else 'fast'
        reason = '多约束分析' if mode == 'deep' else '简单查询或记录'
    thinking = cap.get('thinking', 'unknown')
    args = {}
    if thinking == 'toggle':
        args = {'thinking': {'type': 'enabled' if mode == 'deep' else 'disabled'}} if connection.provider == 'deepseek' else {'enable_thinking': mode == 'deep'}
    elif thinking == 'only':
        if requested == 'fast':
            raise HTTPException(422, '该模型仅支持深度思考')
        mode, reason = 'deep', '模型仅支持思考'
    else:
        if requested == 'deep':
            raise HTTPException(422, '该模型的深度思考能力未验证，请先测试')
        mode, reason = 'default', '使用厂商默认能力；未验证思考切换'
    return args, mode, reason


async def _stream_packets(connection, payload):
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10), follow_redirects=False, trust_env=False) as client:
        async with client.stream('POST', endpoint(connection) + '/chat/completions',
                headers={'Authorization': 'Bearer ' + key_of(connection)}, json={**payload, 'stream': True, 'stream_options': {'include_usage': True}}) as response:
            if response.status_code >= 300:
                raise provider_error(response.status_code)
            async for line in response.aiter_lines():
                if not line.startswith('data:'):
                    continue
                value = line[5:].strip()
                if value == '[DONE]':
                    break
                if value:
                    yield json.loads(value)


def stream_chat(connection, payload):
    # All callers are synchronous worker / API thread-pool functions. Awaiting
    # each packet with the remaining *total* time also bounds headers, silent
    # sockets, SSE comments and unfinished lines. Cancellation closes the socket.
    runner = asyncio.Runner()
    packets = _stream_packets(connection, payload)
    deadline = time.monotonic() + STREAM_MAX_SECONDS
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            try:
                yield runner.run(asyncio.wait_for(anext(packets), remaining))
            except StopAsyncIteration:
                break
    except TimeoutError:
        raise HTTPException(504, '模型响应超时（最长等待3分钟），未执行任务变更，请重试') from None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, '模型流式连接中断，请重试生成') from None
    finally:
        try:
            runner.run(packets.aclose())
        finally:
            runner.close()


def tracked_probe(connection, payload, user_id):
    from .agent import reserve_usage
    from .advanced_models import UsageEvent
    usage = None
    with tenant_session(user_id) as db:
        row = reserve_usage(db, db.get(User,user_id), connection, payload['model'], 'probe', 'probe', len(json.dumps(payload))+payload.get('max_tokens',256))
        identifier = row.id
    try:
        for packet in stream_chat(connection, payload):
            usage = packet.get('usage') or usage
            yield packet
    finally:
        with tenant_session(user_id) as db:
            row = db.scalar(select(UsageEvent).where(UsageEvent.user_id == user_id, UsageEvent.id == identifier))
            if row:
                row.state = 'settled' if usage else 'unknown'
                if usage:
                    row.input_tokens, row.output_tokens = usage.get('prompt_tokens'), usage.get('completion_tokens')
                    if row.input_tokens is not None and row.output_tokens is not None:
                        row.reserved_tokens = row.input_tokens + row.output_tokens


def connection_json(row):
    return {**serialize(row, ('ciphertext',)), 'key_mask': '••••••••'}


@router.get('/provider-connections')
def connections(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [connection_json(r) for r in db.scalars(select(ProviderConnection).where(ProviderConnection.user_id == user.id))]


@router.post('/provider-connections', status_code=201)
def add_connection(body: ConnectionInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    if (body.provider, body.region) not in ENDPOINTS:
        raise HTTPException(422, '厂商与地域组合无效')
    row = ProviderConnection(user_id=user.id, name=body.name, provider=body.provider, region=body.region,
        workspace_id=body.workspace_id,
        ciphertext=cipher().encrypt(body.api_key.encode()).decode())
    db.add(row)
    db.flush()
    return connection_json(row)


@router.delete('/provider-connections/{identifier}')
def remove_connection(identifier: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    pref = preferences(db, user.id, True)
    row = private_owned(db, ProviderConnection, user.id, identifier, True)
    row.enabled, row.ciphertext = False, ''
    row.version += 1
    pref.context_version += 1
    db.execute(delete(ModelPreference).where(ModelPreference.user_id == user.id, ModelPreference.connection_id == identifier))
    for profile in db.scalars(select(EmbeddingProfile).where(EmbeddingProfile.connection_id == identifier, EmbeddingProfile.user_id == user.id)):
        profile.active = False
    return {'message': '连接已停用，凭据已删除'}


@router.get('/provider-connections/{identifier}/models')
def model_list(identifier: str, refresh: bool = False, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = private_owned(db, ProviderConnection, user.id, identifier, True)
    error = None
    if refresh or not row.refreshed_at:
        try:
            models = []
            for page in range(1, 21):
                data = request_json(row, '', params={'page_no':page,'page_size':100} if row.provider=='bailian' else None, catalog_url=catalogue_endpoint(row))
                output = data.get('output', {})
                if data.get('success') is False:
                    raise HTTPException(502, '厂商目录请求失败，请检查地域与业务空间')
                items = output.get('models', []) if row.provider == 'bailian' else data.get('data', [])
                for m in items:
                    identifier = str(m.get('id') or m.get('model'))
                    modality = m.get('capabilities', [])
                    purpose = 'embedding' if any(cap in modality for cap in ('TR','ME')) else 'chat' if not modality or any(cap in modality for cap in ('TG','Reasoning')) else 'other'
                    models.append({'id':identifier,'name':str(m.get('name',identifier)),'purpose':purpose,
                        'capabilities':row.capabilities.get(identifier,{}),'declared_features':m.get('features',[]),'model_info':m.get('model_info',{})})
                if row.provider == 'deepseek' or not items or len(models) >= output.get('total',len(models)):
                    break
            from .models import utcnow
            row.models, row.refreshed_at = list({m['id']: m for m in models}.values()), utcnow()
        except HTTPException as e:
            error = e.detail
    return {'models': row.models, 'refreshed_at': row.refreshed_at, 'error': error, 'cached': bool(error)}


@router.post('/provider-connections/{identifier}/test')
def test_model(identifier: str, body: ModelInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = private_owned(db, ProviderConnection, user.id, identifier)
    baseline_version = row.version
    # Probe the actual selected account/model. Never infer tool support from a name.
    tool = {'type': 'function', 'function': {'name': 'capability_probe', 'description': 'Return the number one',
        'parameters': {'type': 'object', 'properties': {'value': {'type': 'integer'}}, 'required': ['value'], 'additionalProperties': False}}}
    payload = {'model': body.model, 'messages': [{'role': 'user', 'content': 'Call capability_probe with value 1.'}], 'max_tokens': 256}
    documented = DOCUMENTED_THINKING.get(row.provider, {}).get(body.model, 'unknown')
    cap = {'chat': False, 'tools': False, 'thinking': 'only' if documented == 'only' else 'unknown'}
    if 'vision' in row.capabilities.get(body.model, {}):
        cap['vision'] = bool(row.capabilities[body.model]['vision'])
    try:
        packets = list(tracked_probe(row, {**payload, 'tools': [tool], 'tool_choice': {'type': 'function', 'function': {'name': 'capability_probe'}}}, user.id))
        arguments = ''.join(call.get('function', {}).get('arguments', '') for p in packets for choice in p.get('choices', []) for call in choice.get('delta', {}).get('tool_calls', []))
        cap['chat'] = True
        cap['tools'] = json.loads(arguments).get('value') == 1
    except (HTTPException, ValueError, AttributeError):
        packets = list(tracked_probe(row, payload, user.id))
        cap['chat'] = bool(packets)
    # Toggle verification only for the documented parameter; acceptance is reported, not hidden reasoning.
    toggle_args = {'thinking': {'type': 'disabled'}} if row.provider == 'deepseek' else {'enable_thinking': False}
    deep_args = {'thinking': {'type': 'enabled'}} if row.provider == 'deepseek' else {'enable_thinking': True}
    if documented == 'toggle':
        # Auto / fast setup must verify the switch too, otherwise simple chat
        # silently inherits the provider's potentially slow default mode.
        switch_probe = {**payload, 'messages': [{'role': 'user', 'content': '只回答1。'}]}
        try:
            fast = list(tracked_probe(row, {**switch_probe, **toggle_args}, user.id))
            deep = list(tracked_probe(row, {**switch_probe, **deep_args}, user.id))
            if fast and deep:
                cap['thinking'] = 'toggle'
        except HTTPException:
            if body.thinking == 'deep':
                raise
    preferences(db, user.id, True)
    row = private_owned(db, ProviderConnection, user.id, identifier, True)
    db.refresh(row)
    if not row.enabled or row.version != baseline_version:
        raise HTTPException(409, '连接在测试期间已变化，请重试')
    row.capabilities = {**row.capabilities, body.model: cap}
    return {'status': 'ok', 'model': body.model, 'capabilities': cap, 'note': '测试可能产生厂商费用；思考切换需选择深度测试'}


@router.post('/provider-connections/{identifier}/test-vision')
def test_vision(identifier: str, body: ModelInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = private_owned(db, ProviderConnection, user.id, identifier)
    baseline = row.version
    palette = {'红': '#e00000', '绿': '#00b000', '蓝': '#0000e0'}
    colors = secrets.SystemRandom().sample(list(palette), 3)
    image = Image.new('RGB', (192, 64))
    draw = ImageDraw.Draw(image)
    for index, color in enumerate(colors):
        draw.rectangle((index * 64, 0, (index + 1) * 64 - 1, 63), fill=palette[color])
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    args, _, _ = mode_payload(row, body.model, body.thinking, '识别图片')
    payload = {'model': body.model, 'max_tokens': 512, **args, 'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': '图片有三个色块，按从左到右的顺序只返回三个中文颜色名，用逗号隔开。'},
        {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()}},
    ]}]}
    verified, note = False, '当前模型未通过识图测试，图片仍可提取文字。'
    try:
        packets = list(tracked_probe(row, payload, user.id))
        answer = ''.join(choice.get('delta', {}).get('content') or '' for packet in packets for choice in packet.get('choices', []))
        import re
        verified = re.findall('[红绿蓝]', answer) == colors
    except HTTPException as error:
        note = '识图测试未完成：' + error.detail
    preferences(db, user.id, True)
    db.refresh(row)
    if not row.enabled or row.version != baseline:
        raise HTTPException(409, '连接在测试期间已变化，请重试')
    row.capabilities = {**row.capabilities, body.model: {**row.capabilities.get(body.model, {}), 'vision': verified}}
    return {'vision': verified, 'note': '识图测试通过，可以在聊天中识别图片画面。' if verified else note}


@router.get('/model-preferences')
def get_model(user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    row = db.scalar(select(ModelPreference).where(ModelPreference.user_id == user.id))
    return serialize(row) if row else None


@router.put('/model-preferences')
def set_model(body: PreferenceInput, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    preferences(db, user.id, True)
    connection = private_owned(db, ProviderConnection, user.id, body.connection_id)
    key_of(connection)
    if not connection.capabilities.get(body.model, {}).get('chat'):
        raise HTTPException(422, '请先验证选定模型可用')
    mode_payload(connection, body.model, body.thinking, '')
    row = db.scalar(select(ModelPreference).where(ModelPreference.user_id == user.id))
    if not row:
        row = ModelPreference(user_id=user.id, **body.model_dump())
        db.add(row)
    else:
        for name, value in body.model_dump().items():
            setattr(row, name, value)
    db.flush()
    return serialize(row)
