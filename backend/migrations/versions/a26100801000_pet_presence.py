"""Coordinate web and native pet visibility within a browser's desktop link."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a26100801000'
down_revision = 'a26100601000'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('desktop_links', sa.Column('desktop_seen_at', sa.DateTime(timezone=True)))
    op.add_column('desktop_links', sa.Column('web_clients', postgresql.JSONB(), nullable=False, server_default='{}'))


def downgrade():
    op.drop_column('desktop_links', 'web_clients')
    op.drop_column('desktop_links', 'desktop_seen_at')
