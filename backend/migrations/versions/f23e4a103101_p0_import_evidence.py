"""Preserve backup evidence and constrain outbox tenant references."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'f23e4a103101'
down_revision = '62db63508622'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('import_batches', sa.Column('evidence', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.alter_column('import_batches', 'evidence', server_default=None)
    op.create_foreign_key('fk_outbox_tenant_event', 'outbox_events', 'task_events', ['user_id', 'event_id'], ['user_id', 'id'], ondelete='CASCADE')


def downgrade():
    op.drop_constraint('fk_outbox_tenant_event', 'outbox_events', type_='foreignkey')
    op.drop_column('import_batches', 'evidence')
