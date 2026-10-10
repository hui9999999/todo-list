import json
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from app import agent, providers
from app.common import tenant_session
from app.config import settings
from app.advanced_models import ProviderConnection, RunEvent
from test_p1_p4 import PREFIX, connection, run_message, output_stream


@pytest.fixture(autouse=True)
def encryption(monkeypatch):
    monkeypatch.setattr(settings(), 'credential_master_key', Fernet.generate_key().decode())


@pytest.mark.parametrize('message,wants_history', [('删除任务买牛奶', False), ('以前做过类似汇报吗？', True)])
def test_history_is_retrieved_only_when_needed(accounts, monkeypatch, message, wants_history):
    client = accounts(); connection(client)
    calls = []
    monkeypatch.setattr(agent, 'search_history', lambda *a, **kw: calls.append(a[2]) or [])
    monkeypatch.setattr(agent, 'stream_chat', lambda c, p: output_stream({'answer': '请补充具体任务'}))
    _, run, _ = run_message(client, message)
    agent.execute_agent(client.user_id, run['id'])
    assert bool(calls) == wants_history


def test_json_answer_is_visible_before_proposal_finishes_and_no_write_happens(accounts, monkeypatch):
    client = accounts(); conn = connection(client)
    task = client.post(PREFIX+'/tasks', json={'title': '买牛奶', 'notes': '完整备注', 'scope': 'life'}).json()
    with tenant_session(client.user_id) as db:
        db.get(ProviderConnection, conn['id']).capabilities = {'test-model': {'chat': True, 'tools': False}}
    _, run, _ = run_message(client, '删除任务买牛奶')
    def chunks(c, payload):
        yield {'choices': [{'delta': {'content': '{"answer":"请核对\\n删除买牛奶。",'}}]}
        with tenant_session(client.user_id) as db:
            answers = list(db.scalars(select(RunEvent).where(RunEvent.run_id == run['id'], RunEvent.kind == 'answer_delta')))
            assert [event.payload['text'] for event in answers] == ['请核对\n删除买牛奶。']
        assert len(client.get(PREFIX+'/tasks').json()) == 1
        yield {'choices': [{'delta': {'content': '"actions":[{"kind":"trash","task_id":"'+task['id']+'","version":1}]}'}, 'finish_reason': 'stop'}]}
    monkeypatch.setattr(agent, 'stream_chat', chunks)
    agent.execute_agent(client.user_id, run['id'])
    assert client.get(PREFIX+'/agent-runs/'+run['id']).json()['status'] == 'awaiting_confirmation'
    with tenant_session(client.user_id) as db:
        assert len(list(db.scalars(select(RunEvent).where(RunEvent.run_id == run['id'], RunEvent.kind == 'answer_delta')))) == 1
    assert len(client.get(PREFIX+'/tasks').json()) == 1


def test_compact_schema_keeps_task_title_constraints_and_refs():
    from app.ai_schemas import AgentOutput
    original = AgentOutput.model_json_schema()
    compact = agent.compact_schema(original)
    fields = compact['$defs']['TaskFields']
    assert fields['properties']['title']['maxLength'] == 500
    assert fields['properties']['scope']['enum'] == original['$defs']['TaskFields']['properties']['scope']['enum']
    assert compact['properties']['actions']['items'] == {'$ref': '#/$defs/Action'}
    assert len(json.dumps(compact)) < len(json.dumps(original)) * .8


@pytest.mark.parametrize('switch_works', [True, False])
def test_auto_setup_checks_fast_mode_without_breaking_chat(accounts, monkeypatch, switch_works):
    from fastapi import HTTPException
    client = accounts(); conn = connection(client)
    probes = []
    def probe(c, payload, uid):
        probes.append(payload)
        if 'thinking' in payload and not switch_works:
            raise HTTPException(502, 'unsupported')
        if 'tools' in payload:
            yield {'choices': [{'delta': {'tool_calls': [{'function': {'arguments': '{"value":1}'}}]}}]}
        else:
            yield {'choices': [{'delta': {'content': '1'}, 'finish_reason': 'stop'}]}
    monkeypatch.setattr(providers, 'tracked_probe', probe)
    result = client.post(PREFIX+'/provider-connections/'+conn['id']+'/test', json={'model': 'deepseek-flash', 'thinking': 'auto'})
    assert result.status_code == 200, result.text
    assert result.json()['capabilities']['thinking'] == ('toggle' if switch_works else 'unknown')
    assert any(p.get('thinking') == {'type': 'disabled'} for p in probes)
    assert result.json()['capabilities']['chat']
