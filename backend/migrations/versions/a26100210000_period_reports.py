"""Durable calendar reports and per-account automatic schedule cursors."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'a26100210000'
down_revision = 'e61002104300'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('report_schedules',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('weekly_enabled', sa.Boolean(), nullable=False),
        sa.Column('monthly_enabled', sa.Boolean(), nullable=False),
        sa.Column('weekly_next', sa.Date()), sa.Column('monthly_next', sa.Date()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.UniqueConstraint('user_id'), sa.UniqueConstraint('user_id', 'id'))
    # Existing accounts begin at feature activation, without producing years of backfill.
    op.execute("INSERT INTO report_schedules (id,user_id,weekly_enabled,monthly_enabled,created_at,version) "
               "SELECT gen_random_uuid()::text,id,true,true,now(),1 FROM users")
    op.create_table('period_reports',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('start', sa.Date(), nullable=False), sa.Column('end', sa.Date(), nullable=False),
        sa.Column('timezone', sa.String(80), nullable=False), sa.Column('source', sa.String(20), nullable=False),
        sa.Column('partial', sa.Boolean(), nullable=False),
        sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('content', JSONB(), nullable=False),
        sa.UniqueConstraint('user_id', 'id'), sa.UniqueConstraint('user_id', 'kind', 'start'),
        sa.CheckConstraint("kind IN ('weekly','monthly')"))
    for table in ('report_schedules', 'period_reports'):
        op.create_index('ix_' + table + '_user_id', table, ['user_id'])
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
        op.execute(f"CREATE POLICY tenant_scope ON {table} USING "
                   "(user_id = nullif(current_setting('app.user_id', true), '')) "
                   "WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''))")
        op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO todo_app')


def downgrade():
    op.drop_table('period_reports')
    op.drop_table('report_schedules')
