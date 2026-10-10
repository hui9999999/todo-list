"""Allow tenant indexes to use the operator-managed embedding service."""
from alembic import op
import sqlalchemy as sa

revision = 'c314ec08a291'
down_revision = 'b0271070d528'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('embedding_profiles', 'connection_id', existing_type=sa.String(36), nullable=True)


def downgrade():
    # These are derived indexes only. Cascading removes chunks, never original tasks/events.
    op.execute('DELETE FROM embedding_profiles WHERE connection_id IS NULL')
    op.alter_column('embedding_profiles', 'connection_id', existing_type=sa.String(36), nullable=False)
