"""run_context_binding"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '775a736b5809'
down_revision = '7d42aa2229eb'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('agent_runs', sa.Column('context_version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('agent_runs', sa.Column('model_binding', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))

def downgrade():
    op.drop_column('agent_runs', 'model_binding')
    op.drop_column('agent_runs', 'context_version')
