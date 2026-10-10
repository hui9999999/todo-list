"""Browser-authorized desktop account links with single-use pairing tickets."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100510000'
down_revision = 'a26100301000'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('desktop_links',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('browser_session_id', sa.String(64), sa.ForeignKey('sessions.id', ondelete='SET NULL')),
        sa.Column('browser_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('desktop_hash', sa.String(64), unique=True),
        sa.Column('ticket_hash', sa.String(64), unique=True),
        sa.Column('ticket_expires_at', sa.DateTime(timezone=True)),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False))
    # Public auth routes select these records only by an unguessable hashed capability.
    op.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON desktop_links TO todo_app')


def downgrade():
    op.drop_table('desktop_links')
