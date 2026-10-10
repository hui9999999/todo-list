"""Destructive exercises are confined to generated *_test databases, never live data."""
from pathlib import Path
import json
import uuid
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from app.config import settings
from app.backup import backup, journal_snapshot, restore_drill


def test_backup_restore_deletion_replay_and_schema_rollback(accounts,monkeypatch):
    tmp_path=Path(__file__).parents[1]/'.runtime'/'restore-tests'/uuid.uuid4().hex
    a,b=accounts(),accounts()
    t=a.post('/api/v1/tasks',json={'title':'恢复后不得复活'}).json()
    m=a.post('/api/v1/memories',json={'content':'备份中旧偏好','key':'偏好'}).json()
    compose=Path(__file__).parents[2]/'compose.yaml'
    dump=backup(compose,tmp_path)
    assert a.post('/api/v1/memories/'+m['id']+'/forget').status_code==200
    assert a.post('/api/v1/tasks/'+t['id']+'/trash',json={'version':1}).status_code==200
    assert a.post('/api/v1/tasks/'+t['id']+'/purge',json={'version':2}).status_code==200
    assert b.post('/api/v1/account-deletion',json={'confirm_email':b.email}).status_code==200
    journal=tmp_path/'latest-deletions.json'
    data=journal_snapshot(journal)
    assert len(data['markers'])>=3
    name=restore_drill(compose,dump,journal)
    url=make_url(settings().migration_database_url).set(database=name)
    restored=create_engine(url,hide_parameters=True)
    with restored.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM tasks WHERE id=:id'),{'id':t['id']})==0
        assert db.scalar(text('SELECT content FROM memories WHERE id=:id'),{'id':m['id']})==''
        assert db.scalar(text('SELECT count(*) FROM users WHERE id=:id'),{'id':b.user_id})==0
    restored.dispose()
    # A rollback rehearsal on the restored disposable copy verifies all downgrade DDL.
    assert name.endswith('_test') and name!=make_url(settings().migration_database_url).database
    monkeypatch.setattr(settings(),'migration_database_url',url.render_as_string(hide_password=False))
    cfg=Config(str(Path(__file__).parents[1]/'alembic.ini'))
    command.downgrade(cfg,'f23e4a103101')
    command.upgrade(cfg,'head')
    restored=create_engine(url,hide_parameters=True)
    with restored.connect() as db:
        assert db.scalar(text('SELECT version_num FROM alembic_version'))==ScriptDirectory.from_config(cfg).get_current_head()
    restored.dispose()
