"""Add study to the task categories without rewriting existing tasks."""
from alembic import op
import sqlalchemy as sa

revision = 'e61002104300'
down_revision = 'd498b1031002'
branch_labels = None
depends_on = None


def upgrade():
    constraints = sa.inspect(op.get_bind()).get_check_constraints('tasks')
    previous = [item['name'] for item in constraints if 'scope' in item['sqltext'] and 'unassigned' in item['sqltext']]
    if len(previous) != 1:
        raise RuntimeError('Expected exactly one task scope constraint')
    op.drop_constraint(previous[0], 'tasks', type_='check')
    op.create_check_constraint('ck_tasks_scope', 'tasks', "scope IN ('work','life','study','unassigned')")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM tasks WHERE scope='study')")):
        raise RuntimeError('Reassign study tasks before downgrading the category constraint')
    op.drop_constraint('ck_tasks_scope', 'tasks', type_='check')
    op.create_check_constraint('tasks_scope_check', 'tasks', "scope IN ('work','life','unassigned')")
