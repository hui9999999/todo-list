"""Private AI and experience records. Relationships always include tenant identity."""
from datetime import date, datetime
from sqlalchemy import String, Text, Boolean, Integer, Float, Date, DateTime, ForeignKey, ForeignKeyConstraint, UniqueConstraint, CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, declared_attr
from pgvector.sqlalchemy import Vector
from .db import Base
from .models import uid, utcnow


class Private:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint('user_id', 'id'),)


class DeletionMarker(Base):
    """Minimal deletion journal deliberately survives account cascades and backup restore."""
    __tablename__ = 'deletion_markers'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[str] = mapped_column(String(20))
    source_id: Mapped[str] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArticleSource(Base):
    __tablename__ = 'article_sources'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(Text, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(20), default='never')


class Article(Base):
    __tablename__ = 'articles'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source_id: Mapped[str] = mapped_column(ForeignKey('article_sources.id', ondelete='CASCADE'))
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(Text, unique=True)
    text: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def ref(column, table, delete='CASCADE'):
    return ForeignKeyConstraint(['user_id', column], [table + '.user_id', table + '.id'], ondelete=delete)


class UserSettings(Private, Base):
    __tablename__ = 'user_settings'
    __table_args__ = (UniqueConstraint('user_id'), UniqueConstraint('user_id', 'id'))
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    followups_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    news_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    news_topics: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    suggestions_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    weather_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text('true'))
    weather_city: Mapped[str] = mapped_column(String(100), default='北京')
    theme: Mapped[str] = mapped_column(String(20), default='light')
    work_start: Mapped[str] = mapped_column(String(5), default='09:00')
    work_end: Mapped[str] = mapped_column(String(5), default='18:00')
    daily_capacity: Mapped[int | None] = mapped_column(Integer)
    recommendation_time: Mapped[str] = mapped_column(String(5), default='09:00')
    daily_call_limit: Mapped[int] = mapped_column(Integer, default=20)
    daily_token_limit: Mapped[int] = mapped_column(Integer, default=200000)
    version: Mapped[int] = mapped_column(Integer, default=1)
    context_version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Private, Base):
    __tablename__ = 'projects'
    title: Mapped[str] = mapped_column(String(200))
    scope: Mapped[str] = mapped_column(String(20), default='work')


class ReportSchedule(Private, Base):
    __tablename__ = 'report_schedules'
    __table_args__ = (UniqueConstraint('user_id'), UniqueConstraint('user_id', 'id'))
    weekly_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    monthly_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    weekly_next: Mapped[date | None] = mapped_column(Date)
    monthly_next: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1)


class PeriodReport(Private, Base):
    __tablename__ = 'period_reports'
    __table_args__ = (UniqueConstraint('user_id', 'id'),
                     UniqueConstraint('user_id', 'kind', 'start'),
                     CheckConstraint("kind IN ('weekly','monthly')"))
    kind: Mapped[str] = mapped_column(String(20))
    start: Mapped[date] = mapped_column(Date)
    end: Mapped[date] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(20))
    partial: Mapped[bool] = mapped_column(Boolean)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    content: Mapped[dict] = mapped_column(JSONB, default=dict)


class TaskDependency(Private, Base):
    __tablename__ = 'task_dependencies'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('task_id', 'depends_on_id'),
        ref('task_id', 'tasks'), ref('depends_on_id', 'tasks'), CheckConstraint('task_id <> depends_on_id'))
    task_id: Mapped[str] = mapped_column(String(36))
    depends_on_id: Mapped[str] = mapped_column(String(36))


class ProviderConnection(Private, Base):
    __tablename__ = 'provider_connections'
    name: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(20))
    region: Mapped[str] = mapped_column(String(20), default='cn')
    workspace_id: Mapped[str | None] = mapped_column(String(80))
    ciphertext: Mapped[str] = mapped_column(Text)
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    models: Mapped[list] = mapped_column(JSONB, default=list)
    capabilities: Mapped[dict] = mapped_column(JSONB, default=dict)
    refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)


class ModelPreference(Private, Base):
    __tablename__ = 'model_preferences'
    __table_args__ = (UniqueConstraint('user_id'), UniqueConstraint('user_id', 'id'), ref('connection_id', 'provider_connections'))
    connection_id: Mapped[str] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(150))
    thinking: Mapped[str] = mapped_column(String(10), default='auto')


class Conversation(Private, Base):
    __tablename__ = 'conversations'
    title: Mapped[str] = mapped_column(String(100), default='新对话')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Private, Base):
    __tablename__ = 'messages'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('conversation_id', 'conversations'))
    conversation_id: Mapped[str] = mapped_column(String(36))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentRun(Private, Base):
    __tablename__ = 'agent_runs'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('user_id', 'idempotency_key'), ref('conversation_id', 'conversations'), ref('message_id', 'messages'))
    conversation_id: Mapped[str] = mapped_column(String(36))
    message_id: Mapped[str] = mapped_column(String(36))
    idempotency_key: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default='pending')
    clarification: Mapped[dict | None] = mapped_column(JSONB)
    answer: Mapped[str] = mapped_column(Text, default='')
    actual_mode: Mapped[str | None] = mapped_column(String(30))
    mode_reason: Mapped[str | None] = mapped_column(String(200))
    context_version: Mapped[int] = mapped_column(Integer, default=1)
    model_binding: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RunEvent(Private, Base):
    __tablename__ = 'run_events'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('run_id', 'sequence'), ref('run_id', 'agent_runs'))
    run_id: Mapped[str] = mapped_column(String(36))
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict] = mapped_column(JSONB)


class ActionProposal(Private, Base):
    __tablename__ = 'action_proposals'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('run_id', 'agent_runs'))
    run_id: Mapped[str | None] = mapped_column(String(36))
    actions: Mapped[list] = mapped_column(JSONB)
    reason: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20), default='pending')
    version: Mapped[int] = mapped_column(Integer, default=1)
    context_version: Mapped[int] = mapped_column(Integer, default=1, server_default='1')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    result: Mapped[list] = mapped_column(JSONB, default=list)
    before: Mapped[list] = mapped_column(JSONB, default=list)
    undone: Mapped[bool] = mapped_column(Boolean, default=False)


class Memory(Private, Base):
    __tablename__ = 'memories'
    content: Mapped[str] = mapped_column(Text)
    key: Mapped[str] = mapped_column(String(100))
    scope: Mapped[str] = mapped_column(String(20), default='all')
    kind: Mapped[str] = mapped_column(String(30), default='preference')
    state: Mapped[str] = mapped_column(String(20), default='active')
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float, default=1)
    strength: Mapped[float] = mapped_column(Float, default=1)
    half_life_days: Mapped[int] = mapped_column(Integer, default=90)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_message_id: Mapped[str | None] = mapped_column(String(36))
    source_kind: Mapped[str] = mapped_column(String(30), default='explicit')
    version: Mapped[int] = mapped_column(Integer, default=1)
    evidence_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ForgetRequest(Private, Base):
    __tablename__ = 'forget_requests'
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    state: Mapped[str] = mapped_column(String(20), default='pending')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmbeddingProfile(Private, Base):
    __tablename__ = 'embedding_profiles'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('connection_id', 'provider_connections'))
    # NULL denotes the operator-managed embedding service; no user credential is copied.
    connection_id: Mapped[str | None] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(150))
    dimensions: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    state: Mapped[str] = mapped_column(String(20), default='building')


class SearchChunk(Private, Base):
    __tablename__ = 'search_chunks'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('profile_id', 'event_id'), ref('profile_id', 'embedding_profiles'), ref('event_id', 'task_events'))
    profile_id: Mapped[str] = mapped_column(String(36))
    event_id: Mapped[str] = mapped_column(String(36))
    embedding: Mapped[list] = mapped_column(Vector())


class UsageEvent(Private, Base):
    __tablename__ = 'usage_events'
    __table_args__ = (UniqueConstraint('user_id', 'id'), Index('ix_usage_date_user', 'local_date', 'user_id'))
    purpose: Mapped[str] = mapped_column(String(30))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(150))
    mode: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(20), default='reserved')
    reserved_tokens: Mapped[int] = mapped_column(Integer)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    local_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Private, Base):
    __tablename__ = 'jobs'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('user_id', 'dedupe_key'))
    kind: Mapped[str] = mapped_column(String(40))
    dedupe_key: Mapped[str] = mapped_column(String(180))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    state: Mapped[str] = mapped_column(String(20), default='pending')
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(100))


class Recommendation(Private, Base):
    __tablename__ = 'recommendations'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('proposal_id', 'action_proposals'))
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(500))
    reason: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(100), default='')
    url: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(200))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    proposal_id: Mapped[str | None] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(20), default='pending')
    bookmarked: Mapped[bool] = mapped_column(Boolean, default=False)
    local_date: Mapped[date] = mapped_column(Date)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RecommendationFeedback(Private, Base):
    __tablename__ = 'recommendation_feedback'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('recommendation_id', 'recommendations'))
    recommendation_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(30))
    topic: Mapped[str] = mapped_column(String(100))
    source: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RecurrenceRule(Private, Base):
    __tablename__ = 'recurrence_rules'
    template: Mapped[dict] = mapped_column(JSONB)
    frequency: Mapped[str] = mapped_column(String(20))
    interval: Mapped[int] = mapped_column(Integer, default=1)
    mode: Mapped[str] = mapped_column(String(20), default='calendar')
    anchor_date: Mapped[date] = mapped_column(Date)
    next_date: Mapped[date | None] = mapped_column(Date)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class RecurrenceInstance(Private, Base):
    __tablename__ = 'recurrence_instances'
    __table_args__ = (UniqueConstraint('user_id', 'id'), UniqueConstraint('rule_id', 'instance_date'), ref('rule_id', 'recurrence_rules'), ref('task_id', 'tasks'))
    rule_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    instance_date: Mapped[date] = mapped_column(Date)


class FocusSession(Private, Base):
    __tablename__ = 'focus_sessions'
    __table_args__ = (UniqueConstraint('user_id', 'id'), ref('task_id', 'tasks'),
        Index('one_running_focus', 'user_id', unique=True, postgresql_where=text("state = 'running'")))
    task_id: Mapped[str] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(20), default='running')
    duration_seconds: Mapped[int] = mapped_column(Integer)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1)
