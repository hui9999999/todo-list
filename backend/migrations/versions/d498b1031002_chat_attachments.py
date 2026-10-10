"""Store extracted attachments with their tenant-owned chat messages."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'd498b1031002'
down_revision = 'c314ec08a291'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('messages', sa.Column('attachments', JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))


def downgrade():
    op.drop_column('messages', 'attachments')
