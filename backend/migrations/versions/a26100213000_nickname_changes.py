"""Track nickname edits for a daily per-account limit."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100213000'
down_revision = 'a26100212000'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('nickname_changes',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_nickname_changes_user_time', 'nickname_changes', ['user_id', 'changed_at'])
    op.execute('ALTER TABLE nickname_changes ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE nickname_changes FORCE ROW LEVEL SECURITY')
    op.execute("CREATE POLICY tenant_scope ON nickname_changes USING "
               "(user_id = nullif(current_setting('app.user_id', true), '')) "
               "WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''))")
    op.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON nickname_changes TO todo_app')


def downgrade():
    op.drop_table('nickname_changes')
