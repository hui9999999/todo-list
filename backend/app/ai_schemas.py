from datetime import datetime, date
from typing import Literal
from pydantic import Field, model_validator, field_validator
from .news_topics import normalize_topics
from .schemas import Strict, TaskFields, Register, Scope
from .assistant_schemas import DataQuery, ExportRequest, WebSearchQuery


class ConnectionInput(Strict):
    name: str = Field(min_length=1, max_length=100)
    provider: Literal['deepseek', 'bailian']
    region: Literal['cn', 'sg', 'us'] = 'cn'
    workspace_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9-]{1,80}$')
    api_key: str = Field(min_length=8, max_length=1000)


class ModelInput(Strict):
    model: str = Field(min_length=1, max_length=150)
    thinking: Literal['auto', 'fast', 'deep'] = 'auto'


class PreferenceInput(ModelInput):
    connection_id: str


class AttachmentInput(Strict):
    name: str = Field(min_length=1, max_length=200)
    data: str = Field(max_length=11184812)


class MessageInput(Strict):
    content: str = Field(default='', max_length=10000)
    idempotency_key: str = Field(min_length=8, max_length=100)
    attachments: list[AttachmentInput] = Field(default_factory=list, max_length=5)
    web_search_enabled: bool = False

    @model_validator(mode='after')
    def nonempty(self):
        if not self.content.strip() and not self.attachments:
            raise ValueError('请输入消息或添加附件')
        return self


class ClarificationInput(Strict):
    answer: str = Field(min_length=1, max_length=2000)


class RecurrenceSettingsInput(Strict):
    frequency: Literal['daily', 'weekly', 'monthly']
    interval: int = Field(default=1, ge=1, le=365)
    mode: Literal['calendar', 'after_completion'] = 'calendar'
    start_date: date | None = None


class Action(Strict):
    kind: Literal['create', 'update', 'trash', 'plan']
    task_id: str | None = None
    version: int | None = Field(default=None, ge=1)
    fields: TaskFields | None = None
    plan_date: date | None = None
    confirmed_failed_children: dict[str, int] | None = None
    recurrence: RecurrenceSettingsInput | None = None

    @model_validator(mode='after')
    def requirements(self):
        if self.kind == 'create' and not self.fields:
            raise ValueError('缺少任务字段')
        if self.kind != 'create' and (not self.task_id or not self.version):
            raise ValueError('缺少任务与基线版本')
        if self.kind == 'update' and not self.fields and not self.recurrence:
            raise ValueError('缺少修改字段')
        if self.recurrence and (self.kind not in ('create', 'update') or self.plan_date):
            raise ValueError('周期规则仅用于创建或转换任务，不能同时加入指定日期安排')
        if self.kind == 'plan' and not self.plan_date:
            raise ValueError('缺少安排日期')
        return self


class AgentOutput(Strict):
    answer: str = Field(max_length=20000)
    question: str | None = Field(default=None, max_length=1000)
    options: list[str] = Field(default_factory=list, max_length=4)
    actions: list[Action] = Field(default_factory=list, max_length=10)
    followups: list[str] = Field(default_factory=list, max_length=3)
    memories: list[str] = Field(default_factory=list, max_length=3)
    queries: list[DataQuery] = Field(default_factory=list, max_length=5)
    exports: list[ExportRequest] = Field(default_factory=list, max_length=3)
    web_search: list[WebSearchQuery] = Field(default_factory=list, max_length=2)
    web_citations: list[int] = Field(default_factory=list, max_length=10)

    @model_validator(mode='after')
    def distinct(self):
        if self.question and self.actions:
            raise ValueError('澄清和执行提案不能同时发布')
        if (self.queries or self.web_search) and (self.question or self.actions or self.exports or self.memories or self.web_citations):
            raise ValueError('先查询资料，再发布回答、澄清、提案或导出')
        if any(index < 1 or index > 10 for index in self.web_citations):
            raise ValueError('网页引用编号无效')
        if self.exports and (self.question or self.actions):
            raise ValueError('导出与澄清或任务写操作须分开处理')
        return self


class MemoryInput(Strict):
    content: str = Field(min_length=1, max_length=2000)
    key: str = Field(min_length=1, max_length=100)
    scope: Literal['all', 'work', 'life', 'study'] = 'all'
    kind: Literal['preference', 'goal', 'constraint', 'interest'] = 'preference'
    pinned: bool = False
    valid_from: datetime | None = None
    valid_to: datetime | None = None

    @model_validator(mode='after')
    def dates(self):
        for value in (self.valid_from, self.valid_to):
            if value and value.tzinfo is None:
                raise ValueError('期限须包含时区')
        if self.valid_from and self.valid_to and self.valid_to <= self.valid_from:
            raise ValueError('结束时间必须晚于开始时间')
        return self


class SettingsInput(Strict):
    version: int = Field(ge=1)
    timezone: str = Field(default='Asia/Shanghai', max_length=80)
    memory_enabled: bool = True
    followups_enabled: bool = True
    news_enabled: bool = True
    news_topics: list[str] | None = Field(default=None, max_length=8)
    suggestions_enabled: bool = True
    notifications_enabled: bool = True
    weather_enabled: bool = True
    weather_city: str = Field(default='北京', min_length=1, max_length=100)
    theme: Literal['light', 'dark', 'warm'] = 'light'
    work_start: str = Field(default='09:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    work_end: str = Field(default='18:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    recommendation_time: str = Field(default='09:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    daily_capacity: int | None = Field(default=None, ge=1, le=1440)
    daily_call_limit: int = Field(default=20, ge=0, le=100)
    daily_token_limit: int = Field(default=200000, ge=0, le=2000000)

    @field_validator('news_topics')
    @classmethod
    def topics_valid(cls, value):
        return normalize_topics(value) if value is not None else value

    @model_validator(mode='after')
    def valid(self):
        Register.valid_timezone(self.timezone)
        if self.work_end <= self.work_start:
            raise ValueError('工作结束须晚于开始')
        return self


class NewsTopicsInput(Strict):
    version: int = Field(ge=1)
    topics: list[str] = Field(max_length=8)

    @field_validator('topics')
    @classmethod
    def topics_valid(cls, value):
        return normalize_topics(value)


class EmbeddingInput(Strict):
    connection_id: str
    model: str = Field(min_length=1, max_length=150)


class FeedbackInput(Strict):
    action: Literal['skip', 'less_topic', 'block_topic', 'block_source', 'bookmark', 'useful', 'unblock']


class RecurrenceInput(RecurrenceSettingsInput):
    template: TaskFields
    start_date: date

    @model_validator(mode='after')
    def template_valid(self):
        if self.template.parent_id or self.template.status not in ('todo', 'doing'):
            raise ValueError('周期模板须为独立未完成任务')
        return self


class FocusInput(Strict):
    task_id: str
    minutes: int = Field(default=25, ge=1, le=180)


class FocusControl(Strict):
    version: int = Field(ge=1)
    action: Literal['pause', 'resume', 'finish', 'cancel']


class ProjectInput(Strict):
    title: str = Field(min_length=1, max_length=200)
    scope: Scope = 'work'


class DependencyInput(Strict):
    version: int = Field(ge=1)
    depends_on_id: str
