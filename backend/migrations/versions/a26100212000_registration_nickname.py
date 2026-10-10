"""Store optional display names independently of login identifiers."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100212000'
down_revision = 'a26100211000'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('nickname', sa.String(30), nullable=True))


def downgrade():
    op.drop_column('users', 'nickname')
