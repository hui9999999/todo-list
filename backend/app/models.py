import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, Boolean, Integer, DateTime, Date, ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    from datetime import timezone
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = 'users'
    __table_args__ = (
        CheckConstraint('(email IS NOT NULL)::int + (phone IS NOT NULL)::int + (username IS NOT NULL)::int = 1', name='ck_users_identifier'),
        CheckConstraint('username IS NULL OR is_admin', name='ck_users_admin_username'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    username: Mapped[str | None] = mapped_column(String(32), unique=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, server_default=text('false'))
    nickname: Mapped[str | None] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    timezone: Mapped[str] = mapped_column(String(80), default='Asia/Shanghai')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NicknameChange(Base):
    __tablename__ = 'nickname_changes'
    __table_args__ = (Index('ix_nickname_changes_user_time', 'user_id', 'changed_at'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LoginSession(Base):
    __tablename__ = 'sessions'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DesktopLink(Base):
    __tablename__ = 'desktop_links'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    browser_session_id: Mapped[str | None] = mapped_column(ForeignKey('sessions.id', ondelete='SET NULL'))
    browser_hash: Mapped[str] = mapped_column(String(64), unique=True)
    desktop_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    ticket_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    ticket_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)
    desktop_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    web_clients: Mapped[dict] = mapped_column(JSONB, default=dict)


class AuthToken(Base):
    __tablename__ = 'auth_tokens'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuthAttempt(Base):
    __tablename__ = 'auth_attempts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    key: Mapped[str] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Task(Base):
    __tablename__ = 'tasks'
    __table_args__ = (
        UniqueConstraint('user_id', 'id'),
        ForeignKeyConstraint(['user_id', 'parent_id'], ['tasks.user_id', 'tasks.id']),
        ForeignKeyConstraint(['user_id', 'project_id'], ['projects.user_id', 'projects.id'], name='fk_tasks_tenant_project'),
        CheckConstraint("scope IN ('work','life','study','unassigned')", name='ck_tasks_scope'),
        CheckConstraint("status IN ('todo','doing','done','failed','cancelled')"),
        CheckConstraint("priority IN ('high','mid','low')"),
        CheckConstraint('due_date IS NULL OR due_at IS NULL'),
        CheckConstraint('parent_id IS NULL OR parent_id <> id'),
        CheckConstraint('version > 0'),
        Index('ix_tasks_user_status_due', 'user_id', 'status', 'due_at'),
        Index('ix_tasks_user_due_date', 'user_id', 'due_date'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    title: Mapped[str] = mapped_column(String(500))
    project_id: Mapped[str | None] = mapped_column(String(36))
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default='')
    scope: Mapped[str] = mapped_column(String(20), default='unassigned')
    status: Mapped[str] = mapped_column(String(20), default='todo')
    priority: Mapped[str] = mapped_column(String(10), default='mid')
    parent_id: Mapped[str | None] = mapped_column(String(36))
    due_date: Mapped[date | None] = mapped_column(Date)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_timezone: Mapped[str | None] = mapped_column(String(80))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    fail_reason: Mapped[str] = mapped_column(Text, default='')
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    legacy_period: Mapped[str | None] = mapped_column(String(10))
    legacy_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timer_minutes: Mapped[int] = mapped_column(Integer, default=25)
    timer_remaining: Mapped[int] = mapped_column(Integer, default=1500)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_group: Mapped[str | None] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer, default=1)


class TaskEvent(Base):
    __tablename__ = 'task_events'
    __table_args__ = (
        UniqueConstraint('user_id', 'id'),
        ForeignKeyConstraint(['user_id', 'task_id'], ['tasks.user_id', 'tasks.id'], ondelete='CASCADE'),
        Index('ix_events_user_time', 'user_id', 'occurred_at'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(30))
    actor: Mapped[str] = mapped_column(String(30), default='user')
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    before_version: Mapped[int | None] = mapped_column(Integer)
    after_version: Mapped[int] = mapped_column(Integer)


class TaskSnapshot(Base):
    __tablename__ = 'task_snapshots'
    __table_args__ = (ForeignKeyConstraint(['user_id', 'event_id'], ['task_events.user_id', 'task_events.id'], ondelete='CASCADE'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    event_id: Mapped[str] = mapped_column(String(36), unique=True)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict] = mapped_column(JSONB)


class OutboxEvent(Base):
    __tablename__ = 'outbox_events'
    __table_args__ = (ForeignKeyConstraint(['user_id', 'event_id'], ['task_events.user_id', 'task_events.id'], ondelete='CASCADE'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    event_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DailyPlanItem(Base):
    __tablename__ = 'daily_plan_items'
    __table_args__ = (
        UniqueConstraint('user_id', 'task_id', 'plan_date'),
        ForeignKeyConstraint(['user_id', 'task_id'], ['tasks.user_id', 'tasks.id'], ondelete='CASCADE'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    task_id: Mapped[str] = mapped_column(String(36))
    plan_date: Mapped[date] = mapped_column(Date)


class ImportBatch(Base):
    __tablename__ = 'import_batches'
    __table_args__ = (UniqueConstraint('user_id', 'digest', 'scope'), UniqueConstraint('user_id', 'id'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    digest: Mapped[str] = mapped_column(String(64))
    scope: Mapped[str] = mapped_column(String(20))
    normalized: Mapped[list] = mapped_column(JSONB)
    issues: Mapped[list] = mapped_column(JSONB)
    warnings: Mapped[list] = mapped_column(JSONB)
    evidence: Mapped[dict] = mapped_column(JSONB, default=dict)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ImportMapping(Base):
    __tablename__ = 'import_item_mappings'
    __table_args__ = (
        UniqueConstraint('user_id', 'batch_id', 'legacy_id'),
        ForeignKeyConstraint(['user_id', 'batch_id'], ['import_batches.user_id', 'import_batches.id'], ondelete='CASCADE'),
        ForeignKeyConstraint(['user_id', 'task_id'], ['tasks.user_id', 'tasks.id'], ondelete='CASCADE'),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    batch_id: Mapped[str] = mapped_column(String(36))
    legacy_id: Mapped[str] = mapped_column(String(100))
    task_id: Mapped[str] = mapped_column(String(36))
