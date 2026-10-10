"""Validated, tenant-scoped read and export requests. No SQL, URLs or user IDs."""
from datetime import date as DateValue
from typing import Literal
from pydantic import Field, model_validator, field_validator
from .schemas import Strict

Category = Literal['all', 'account', 'tasks', 'trash', 'plans', 'projects', 'dependencies',
    'recurrences', 'recurrence_instances', 'focus', 'history', 'snapshots', 'conversations',
    'messages', 'memories', 'reports', 'report_schedule', 'settings', 'connections',
    'model_preferences', 'embedding_profiles', 'usage', 'recommendations', 'feedback',
    'imports', 'proposals', 'runs', 'jobs', 'forget_requests', 'nickname_changes', 'sessions']


class WebSearchQuery(Strict):
    q: str = Field(min_length=1, max_length=200)

    @field_validator('q')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('请输入搜索关键词')
        return value.strip()


class DataQuery(Strict):
    category: Category
    q: str = Field(default='', max_length=200)
    id: str | None = Field(default=None, max_length=100)
    task_id: str | None = Field(default=None, max_length=100)
    conversation_id: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=40)
    start: DateValue | None = None
    end: DateValue | None = None
    date_field: Literal['auto', 'created_at', 'updated_at', 'completed_at', 'due', 'deleted_at',
        'occurred_at', 'started_at', 'plan_date', 'start', 'local_date'] = 'auto'
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=50)
    fields: list[str] = Field(default_factory=list, max_length=15)

    @model_validator(mode='after')
    def dates(self):
        if self.start and self.end and self.start > self.end:
            raise ValueError('结束日期不能早于开始日期')
        if self.end == DateValue.max:
            raise ValueError('结束日期超出范围')
        return self


class ExportRequest(Strict):
    kind: Literal['account', 'tasks', 'weekly', 'monthly']
    format: Literal['json', 'xlsx', 'pdf', 'docx', 'csv'] = 'xlsx'
    date: DateValue | None = None
    start: DateValue | None = None
    end: DateValue | None = None
    date_field: Literal['created', 'completed', 'updated', 'due'] = 'created'
    scope: Literal['all', 'work', 'life', 'study', 'unassigned'] = 'all'
    status: Literal['all', 'todo', 'doing', 'done', 'failed', 'cancelled'] = 'all'
    include_trash: bool = False
    include_notes: bool = True

    @model_validator(mode='after')
    def valid(self):
        if self.kind=='account' and 'format' not in self.model_fields_set:
            self.format='json'
        if self.kind=='account' and (self.date or self.start or self.end or self.scope!='all' or self.status!='all' or self.include_trash or not self.include_notes):
            raise ValueError('完整账号资料不接受筛选；需要任务筛选时使用 kind=tasks')
        if self.kind=='tasks' and self.date:
            raise ValueError('任务筛选使用 start/end，不使用 date')
        if self.kind == 'account' and self.format != 'json':
            raise ValueError('完整账号资料使用 JSON 格式')
        if self.kind != 'account' and self.format == 'json':
            raise ValueError('任务和周期报告使用 Excel、PDF、Word 或 CSV')
        if self.kind in ('weekly', 'monthly') and (self.start or self.end or self.scope != 'all' or self.status != 'all' or self.include_trash):
            raise ValueError('周报月报使用 date 指定周期，包含该周期完整统计')
        if self.start and self.end and self.start > self.end:
            raise ValueError('结束日期不能早于开始日期')
        if self.end == DateValue.max or (self.date and not 1900 <= self.date.year <= 9998):
            raise ValueError('报告日期超出范围')
        return self
