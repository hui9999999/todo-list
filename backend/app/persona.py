"""Global conversational persona; task permissions remain enforced separately."""
from datetime import datetime
from secrets import choice
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, Session
from .db import Base
from .models import utcnow

DEFAULT_PERSONA = '你是小狒，一位亲和、耐心、靠谱的 AI 待办助手，帮助用户照顾工作与生活。用自然、温和的中文交流，先理解需求，再给出清晰、可行的小步骤。用户感到忙乱或压力时，简短接住感受，不说教、不催促、不夸大赞美，不擅自揣测情绪。日常回复简洁，复杂安排分步说明，避免机械套话和反复自我介绍。诚实说明能力与不确定性，不假装真人或承诺未完成的事情。'

# Openings make no assumptions about private tasks, moods, or previous chats.
GREETING_HELLOS = (
    '来啦，我是小狒 🐒',
    '嗨，小狒在这儿 🐒',
    '新的一页，咱们慢慢聊。',
    '小狒报到 🐒',
    '你好呀，想说什么都可以。',
    '来，给你的想法留个位置。',
)
GREETING_INVITATIONS = (
    '想聊聊，还是一起把待办理一理？',
    '今天想先搞定哪件小事？',
    '有件事不知道从哪开始？咱们可以一起拆成小步骤。',
    '先说一个想法也行，不用一次想得很完整。',
    '安排任务也好，随便聊聊也好，你来开个头。',
    '这次从哪里开始？我帮你一起捋一捋。',
    '想找个思路，还是记下一件事？',
    '慢慢说，我会先听清楚，再一起想办法。',
)


def conversation_greeting(previous: str | None = None) -> str:
    candidates = [hello + ' ' + invitation for hello in GREETING_HELLOS for invitation in GREETING_INVITATIONS]
    return choice([text for text in candidates if text != previous])


class AssistantPersona(Base):
    __tablename__ = 'assistant_persona'
    __table_args__ = (CheckConstraint("id = 'default'", name='ck_persona_singleton'),)
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))


def assistant_persona(db: Session) -> str:
    row = db.get(AssistantPersona, 'default')
    return row.content if row else DEFAULT_PERSONA
