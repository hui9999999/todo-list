import logging
from pathlib import Path
import time
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from . import auth, tasks, data, providers, agent, memory, experience, recommendations, period_reports, admin
from .db import engine
from .config import settings
from .assistant_exports import router as assistant_exports_router

app = FastAPI(title='AI 待办清单 2.0', version='0.1.0', docs_url='/api/docs', redoc_url=None, openapi_url='/api/openapi.json')
app.include_router(auth.router, prefix='/api/v1')
app.include_router(tasks.router, prefix='/api/v1')
app.include_router(data.router, prefix='/api/v1')
app.include_router(assistant_exports_router, prefix='/api/v1')
for router in (providers.router, agent.router, memory.router, experience.router, recommendations.router, period_reports.router, admin.router):
    app.include_router(router, prefix='/api/v1')


@app.middleware('http')
async def private_headers(request: Request, call_next):
    if request.method == 'POST' and request.url.path.startswith('/api/v1/conversations/') and request.url.path.endswith('/messages'):
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 30 * 1024 * 1024:
                return JSONResponse(status_code=413, content={'detail': '消息附件过大，单个文件最多 8 MB，合计最多 30 MB'}, headers={'Cache-Control': 'no-store'})
            chunks.append(chunk)
        request._body = b''.join(chunks)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(request, error):
    # FastAPI's default embeds invalid input, which could be a password or Key.
    return JSONResponse(status_code=422, content={'detail': '字段格式无效，请检查必填项、长度、枚举与日期'})


@app.exception_handler(SQLAlchemyError)
async def database_error(request, error):
    logging.getLogger('todo').error('Database operation failed: %s', type(error).__name__)
    return JSONResponse(status_code=503, content={'detail': '数据服务暂时不可用，请稍后重试'})


@app.get('/api/v1/health')
def health():
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
    heartbeat = Path(settings().deletion_journal_file).parent / 'worker-heartbeat'
    worker_alive = heartbeat.exists() and time.time() - heartbeat.stat().st_mtime < 360
    return {'status': 'ok', 'phase': 'P1-P4 development', 'worker_alive': worker_alive}
