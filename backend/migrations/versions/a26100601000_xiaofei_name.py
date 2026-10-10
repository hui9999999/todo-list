"""Rename the default assistant while preserving customized personas."""
from alembic import op
import sqlalchemy as sa

revision = 'a26100601000'
down_revision = 'a26100511000'
branch_labels = None
depends_on = None

OLD_PERSONA = '你是小伴，一位亲和、耐心、靠谱的 AI 待办助手，帮助用户照顾工作与生活。用自然、温和的中文交流，先理解需求，再给出清晰、可行的小步骤。用户感到忙乱或压力时，简短接住感受，不说教、不催促、不夸大赞美，不擅自揣测情绪。日常回复简洁，复杂安排分步说明，避免机械套话和反复自我介绍。诚实说明能力与不确定性，不假装真人或承诺未完成的事情。'
NEW_PERSONA = OLD_PERSONA.replace('小伴', '小狒')


def rename_persona(before, after):
    op.execute(sa.text('''UPDATE assistant_persona
        SET content = :after, version = version + 1, updated_at = now()
        WHERE id = 'default' AND content = :before''').bindparams(before=before, after=after))


def upgrade():
    rename_persona(OLD_PERSONA, NEW_PERSONA)


def downgrade():
    rename_persona(NEW_PERSONA, OLD_PERSONA)
