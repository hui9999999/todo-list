"""Persist explicit news interests without changing existing preferences."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a26100901000'
down_revision = 'a26100801000'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user_settings', sa.Column('news_topics', postgresql.JSONB(), nullable=False, server_default='[]'))


def downgrade():
    op.drop_column('user_settings', 'news_topics')
