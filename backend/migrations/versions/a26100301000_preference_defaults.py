"""Enable preferences by default for new settings, preserving saved choices."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100301000'
down_revision = 'a26100213000'
branch_labels = None
depends_on = None
FLAGS = ('memory_enabled', 'followups_enabled', 'news_enabled', 'suggestions_enabled', 'notifications_enabled', 'weather_enabled')


def upgrade():
    for flag in FLAGS:
        op.alter_column('user_settings', flag, existing_type=sa.Boolean(), server_default=sa.true())


def downgrade():
    for flag in FLAGS:
        op.alter_column('user_settings', flag, existing_type=sa.Boolean(), server_default=None)
