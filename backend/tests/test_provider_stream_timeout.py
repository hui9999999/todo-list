"""Exercise the transport, including bytes that never yield an SSE packet."""
import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from app import providers


class ProviderBody(httpx.SyncByteStream, httpx.AsyncByteStream):
    def __init__(self, chunks, interval):
        self.chunks, self.interval, self.closed = chunks, interval, False

    def __iter__(self):
        for chunk in self.chunks:
            time.sleep(self.interval)
            yield chunk

    async def __aiter__(self):
        for chunk in self.chunks:
            await asyncio.sleep(self.interval)
            yield chunk

    def close(self):
        self.closed = True

    async def aclose(self):
        self.closed = True


def transport(monkeypatch, chunks, interval=0, headers_delay=0):
    body = ProviderBody(chunks, interval)
    def handler(request):
        time.sleep(headers_delay)
        return httpx.Response(200, stream=body)
    async def async_handler(request):
        await asyncio.sleep(headers_delay)
        return httpx.Response(200, stream=body)
    sync_client, async_client = httpx.Client, httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kw: sync_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kw: async_client(transport=httpx.MockTransport(async_handler), **kw))
    monkeypatch.setattr(providers, 'key_of', lambda c: 'fake-test-key')
    monkeypatch.setattr(providers, 'STREAM_MAX_SECONDS', .15, raising=False)
    return body


CONNECTION = SimpleNamespace(provider='deepseek', region='cn')


@pytest.mark.parametrize('chunks,interval,headers_delay', [
    ([b': heartbeat\n\n'] * 30, .025, 0),
    ([b' '] * 30, .025, 0),
    ([b'data: [DONE]\n\n'], .8, 0),
    ([b'data: [DONE]\n\n'], 0, .8),
])
def test_absolute_deadline_includes_heartbeats_incomplete_lines_silence_and_headers(monkeypatch, chunks, interval, headers_delay):
    body = transport(monkeypatch, chunks, interval, headers_delay)
    started = time.monotonic()
    with pytest.raises(HTTPException) as error:
        list(providers.stream_chat(CONNECTION, {'model': 'test'}))
    assert error.value.status_code == 504
    assert time.monotonic() - started < .65
    if not headers_delay:
        assert body.closed


def test_stream_preserves_split_packets_usage_and_done(monkeypatch):
    body = transport(monkeypatch, [b': hi\n\ndata: {"choices":', b'[]}\n\ndata: {"usage":{"completion_tokens":2}}\n\n', b'data: [DONE]\n\n'])
    assert list(providers.stream_chat(CONNECTION, {})) == [{'choices': []}, {'usage': {'completion_tokens': 2}}]
    assert body.closed


def test_invalid_packet_remains_controlled_error(monkeypatch):
    body = transport(monkeypatch, [b'data: malformed\n\n'])
    with pytest.raises(HTTPException) as error:
        list(providers.stream_chat(CONNECTION, {}))
    assert error.value.status_code == 502
    assert body.closed
