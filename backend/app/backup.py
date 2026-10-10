"""Local container backup and isolated restore/replay drill; never overwrite the live DB."""
import argparse
import json
import subprocess
import uuid
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from .config import settings
from .models import utcnow


def command(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise RuntimeError('容器备份命令失败；未修改在线数据库')
    return result.stdout.decode(errors='replace').strip()


def compose_prefix(filename):
    return ['docker', 'compose', '-f', str(Path(filename).resolve())]


def journal_snapshot(output):
    engine = create_engine(settings().migration_database_url, hide_parameters=True)
    with engine.connect() as conn:
        rows = conn.execute(text('SELECT id,user_id,scope,source_id,occurred_at FROM deletion_markers')).mappings().all()
        data = {'schema_version': 1, 'markers': [dict(row) for row in rows]}
    engine.dispose()
    Path(output).write_text(json.dumps(data, default=str), encoding='utf-8')
    return data


def replay_markers(connection, data):
    """Called before admitting users to a restored database. Bodies are never retained."""
    markers = data.get('markers', [])
    affected = set()
    for item in markers:
        user_id, source_id, scope = item['user_id'], item['source_id'], item['scope']
        if scope not in ('account', 'task', 'memory', 'message', 'conversation'):
            raise ValueError('无效删除日志')
        affected.add(user_id)
        connection.execute(text("INSERT INTO deletion_markers (id,user_id,scope,source_id,occurred_at) VALUES (:id,:user_id,:scope,:source_id,:occurred_at) ON CONFLICT(id) DO NOTHING"), item)
        if scope == 'account':
            connection.execute(text('DELETE FROM users WHERE id=:id'), {'id': user_id})
        elif scope == 'task':
            # Detach links in the restored tree, then remove this source and cascaded evidence/indexes.
            connection.execute(text('UPDATE tasks SET parent_id=NULL WHERE user_id=:user AND parent_id=:source'), {'user': user_id, 'source': source_id})
            connection.execute(text('DELETE FROM tasks WHERE user_id=:user AND id=:source'), {'user': user_id, 'source': source_id})
            # Backups predating calendar reports do not contain this table.
            if connection.scalar(text("SELECT to_regclass('public.period_reports')")):
                for key in ('completed', 'carryover'):
                    connection.execute(text(f"UPDATE period_reports SET content=jsonb_set(content, '{{{key}}}', "
                        f"COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(content->'{key}') item "
                        "WHERE item->>'task_id' <> :source), '[]'::jsonb)) WHERE user_id=:user"),
                        {'user': user_id, 'source': source_id})
        elif scope == 'memory':
            connection.execute(text("UPDATE memories SET content='',state='revoked',version=version+1 WHERE user_id=:user AND id=:source"), {'user': user_id, 'source': source_id})
        elif scope == 'message':
            connection.execute(text("UPDATE messages SET content='[已遗忘来源]' WHERE user_id=:user AND id=:source"), {'user': user_id, 'source': source_id})
            connection.execute(text("UPDATE memories SET content='',state='revoked',version=version+1 WHERE user_id=:user AND source_message_id=:source"), {'user': user_id, 'source': source_id})
        else:
            connection.execute(text('DELETE FROM conversations WHERE user_id=:user AND id=:source'), {'user': user_id, 'source': source_id})
    for user_id in affected:
        # Conservative invalidation removes derived copies and outstanding proposals/queued calls.
        params = {'user': user_id}
        connection.execute(text("UPDATE messages SET content='[来源已删除，回答已清理]' WHERE user_id=:user AND role='assistant'"), params)
        connection.execute(text("UPDATE agent_runs SET answer='',clarification=NULL,status='cancelled' WHERE user_id=:user"), params)
        connection.execute(text('DELETE FROM run_events WHERE user_id=:user'), params)
        connection.execute(text("UPDATE action_proposals SET actions='[]',before='[]',result='[]',reason='',state='expired' WHERE user_id=:user"), params)
        connection.execute(text("UPDATE recommendations SET reason='',title='[相关内容已删除]',state='expired' WHERE user_id=:user"), params)
        connection.execute(text("UPDATE jobs SET state='cancelled',payload='{}' WHERE user_id=:user AND state IN ('pending','running')"), params)
        connection.execute(text('UPDATE user_settings SET context_version=context_version+1 WHERE user_id=:user'), params)
    # Sessions restored from old backups are never accepted.
    connection.execute(text('DELETE FROM sessions'))
    connection.execute(text('DELETE FROM auth_tokens'))


def backup(compose_file, output):
    path = Path(output).resolve()
    path.mkdir(parents=True, exist_ok=True)
    filename = 'todo-' + utcnow().strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8] + '.dump'
    container = command(compose_prefix(compose_file) + ['ps', '-q', 'db'])
    remote = '/tmp/' + filename
    command(compose_prefix(compose_file) + ['exec', '-T', 'db', 'pg_dump', '-U', 'todo_owner', '-d', make_url(settings().migration_database_url).database, '-Fc', '-f', remote])
    dump = path / filename
    command(['docker', 'cp', container + ':' + remote, str(dump)])
    journal_snapshot(path / 'latest-deletions.json')
    manifest = {'schema_version': 1, 'created_at': str(utcnow()), 'database': dump.name,
        'master_key': '单独保管 CREDENTIAL_MASTER_KEY 或 credential.key；主密钥未包含在数据库备份',
        'retention_days': 30}
    (path / (filename + '.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(str(dump))
    return dump


def restore_drill(compose_file, dump, journal):
    dump, journal = Path(dump).resolve(), Path(journal).resolve()
    if not dump.is_file() or not journal.is_file():
        raise ValueError('备份或最新删除日志不存在')
    admin_url = make_url(settings().migration_database_url)
    name = 'todo_drill_' + uuid.uuid4().hex[:12] + '_test'
    if name == admin_url.database or not name.endswith('_test'):
        raise ValueError('恢复目标必须为隔离测试库')
    admin = create_engine(admin_url.set(database='postgres'), isolation_level='AUTOCOMMIT', hide_parameters=True)
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE {name}'))
    container = command(compose_prefix(compose_file) + ['ps', '-q', 'db'])
    remote = '/tmp/drill-' + uuid.uuid4().hex + '.dump'
    command(['docker', 'cp', str(dump), container + ':' + remote])
    command(compose_prefix(compose_file) + ['exec', '-T', 'db', 'pg_restore', '-U', 'todo_owner', '-d', name, '--exit-on-error', remote])
    restored = create_engine(admin_url.set(database=name), hide_parameters=True)
    data = json.loads(journal.read_text(encoding='utf-8'))
    with restored.begin() as conn:
        replay_markers(conn, data)
        tables = conn.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"))
        assert conn.scalar(text('SELECT count(*) FROM sessions')) == 0
        for marker in data['markers']:
            if marker['scope'] == 'account':
                assert conn.scalar(text('SELECT count(*) FROM users WHERE id=:id'), {'id': marker['user_id']}) == 0
            elif marker['scope'] == 'memory':
                assert conn.scalar(text("SELECT count(*) FROM memories WHERE id=:id AND content<>''"), {'id': marker['source_id']}) == 0
    with restored.connect() as conn:
        sample = conn.execute(text('SELECT id,user_id FROM tasks LIMIT 1')).first()
    if sample:
        app_engine = create_engine(make_url(settings().database_url).set(database=name), hide_parameters=True)
        with app_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.user_id',:id,true)"), {'id': sample.user_id})
            assert conn.scalar(text('SELECT count(*) FROM tasks WHERE id=:id'), {'id': sample.id}) == 1
            conn.execute(text("SELECT set_config('app.user_id',:id,true)"), {'id': str(uuid.uuid4())})
            assert conn.scalar(text('SELECT count(*) FROM tasks')) == 0
        app_engine.dispose()
    restored.dispose()
    admin.dispose()
    print(json.dumps({'status':'passed','restored_database':name,'tables':tables,'deletion_markers_replayed':len(data['markers']),
        'sessions_revoked':True,'live_database_unchanged':True}))
    return name


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--compose-file',default='../compose.yaml')
    sub=parser.add_subparsers(dest='action',required=True)
    create=sub.add_parser('backup');create.add_argument('--output',default='.runtime/backups')
    restore=sub.add_parser('restore-drill');restore.add_argument('--dump',required=True);restore.add_argument('--journal',required=True)
    args=parser.parse_args()
    if args.action=='backup':backup(args.compose_file,args.output)
    else:restore_drill(args.compose_file,args.dump,args.journal)


if __name__=='__main__':main()
