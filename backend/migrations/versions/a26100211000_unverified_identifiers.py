"""Allow email or phone registration, without an activation step."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100211000'
down_revision = 'a26100210000'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('users', 'email', existing_type=sa.String(254), nullable=True)
    op.add_column('users', sa.Column('phone', sa.String(20), nullable=True))
    op.create_unique_constraint('uq_users_phone', 'users', ['phone'])
    op.create_check_constraint('ck_users_identifier', 'users', '(email IS NOT NULL) <> (phone IS NOT NULL)')
    op.execute('UPDATE users SET verified=true WHERE NOT verified')
    op.alter_column('users', 'verified', server_default=sa.text('true'))


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM users WHERE phone IS NOT NULL)')):
        raise RuntimeError('Phone accounts must be migrated before removing phone support')
    op.drop_constraint('ck_users_identifier', 'users', type_='check')
    op.drop_constraint('uq_users_phone', 'users', type_='unique')
    op.drop_column('users', 'phone')
    op.alter_column('users', 'email', existing_type=sa.String(254), nullable=False)
    op.alter_column('users', 'verified', server_default=None)
