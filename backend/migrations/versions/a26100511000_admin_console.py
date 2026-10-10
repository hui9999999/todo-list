"""Administrator console, metered usage read policy and global assistant persona."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100511000'
down_revision = 'a26100510000'
branch_labels = None
depends_on = None

ADMIN_CHECK = "EXISTS (SELECT 1 FROM users WHERE id = nullif(current_setting('app.user_id', true), '') AND is_admin)"
USER_COLUMNS = 'id, email, phone, username, nickname, password_hash, verified, timezone, created_at'


def upgrade():
    op.add_column('users', sa.Column('username', sa.String(32), unique=True))
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.drop_constraint('ck_users_identifier', 'users', type_='check')
    op.create_check_constraint('ck_users_identifier', 'users', '(email IS NOT NULL)::int + (phone IS NOT NULL)::int + (username IS NOT NULL)::int = 1')
    op.create_check_constraint('ck_users_admin_username', 'users', 'username IS NULL OR is_admin')
    # The web/worker role can never grant itself administrator status or create a username account.
    op.execute('REVOKE INSERT, UPDATE ON users FROM todo_app')
    op.execute(f'GRANT INSERT ({USER_COLUMNS}), UPDATE ({USER_COLUMNS}) ON users TO todo_app')
    op.execute(f'CREATE POLICY admin_usage_read ON usage_events FOR SELECT USING ({ADMIN_CHECK})')
    op.create_index('ix_usage_date_user', 'usage_events', ['local_date', 'user_id'])
    op.create_table('assistant_persona',
        sa.Column('id', sa.String(20), primary_key=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.CheckConstraint("id = 'default'", name='ck_persona_singleton'))
    op.execute(sa.text("INSERT INTO assistant_persona (id, content, version) VALUES ('default', :content, 1)").bindparams(content='你是小伴，一位亲和、耐心、靠谱的 AI 待办助手，帮助用户照顾工作与生活。用自然、温和的中文交流，先理解需求，再给出清晰、可行的小步骤。用户感到忙乱或压力时，简短接住感受，不说教、不催促、不夸大赞美，不擅自揣测情绪。日常回复简洁，复杂安排分步说明，避免机械套话和反复自我介绍。诚实说明能力与不确定性，不假装真人或承诺未完成的事情。'))
    op.execute('ALTER TABLE assistant_persona ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE assistant_persona FORCE ROW LEVEL SECURITY')
    op.execute('CREATE POLICY persona_read ON assistant_persona FOR SELECT USING (true)')
    op.execute(f'CREATE POLICY persona_admin_write ON assistant_persona FOR UPDATE USING ({ADMIN_CHECK}) WITH CHECK ({ADMIN_CHECK})')
    op.execute('GRANT SELECT, UPDATE ON assistant_persona TO todo_app')


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM users WHERE username IS NOT NULL)')):
        raise RuntimeError('Migrate administrator username accounts before removing support')
    op.drop_table('assistant_persona')
    op.drop_index('ix_usage_date_user', table_name='usage_events')
    op.execute('DROP POLICY admin_usage_read ON usage_events')
    op.execute(f'REVOKE INSERT ({USER_COLUMNS}), UPDATE ({USER_COLUMNS}) ON users FROM todo_app')
    op.execute('GRANT INSERT, UPDATE ON users TO todo_app')
    op.drop_constraint('ck_users_admin_username', 'users', type_='check')
    op.drop_constraint('ck_users_identifier', 'users', type_='check')
    op.drop_column('users', 'username')
    op.drop_column('users', 'is_admin')
    op.create_check_constraint('ck_users_identifier', 'users', '(email IS NOT NULL) <> (phone IS NOT NULL)')
