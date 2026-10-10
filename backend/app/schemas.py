from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator
from .identity import normalize_identifier, normalize_login_identifier

Scope = Literal['work', 'life', 'study', 'unassigned']
Status = Literal['todo', 'doing', 'done', 'failed', 'cancelled']
Priority = Literal['high', 'mid', 'low']


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AccountIdentifier(Strict):
    identifier: str = Field(min_length=1, max_length=254, validation_alias=AliasChoices('identifier', 'email', 'phone'))

    @field_validator('identifier')
    @classmethod
    def normalize(cls, value):
        return normalize_identifier(value)


class Register(AccountIdentifier):
    password: str = Field(min_length=10, max_length=128)
    nickname: str | None = Field(default=None, max_length=30)
    timezone: str = 'Asia/Shanghai'

    @field_validator('nickname', mode='before')
    @classmethod
    def normalize_nickname(cls, value):
        return value.strip() or None if isinstance(value, str) else value

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('无效时区')
        return v


class NicknameUpdate(Strict):
    nickname: str = Field(min_length=1, max_length=30)

    @field_validator('nickname', mode='before')
    @classmethod
    def trim_nickname(cls, value):
        return value.strip() if isinstance(value, str) else value


class Login(AccountIdentifier):
    password: str = Field(min_length=1, max_length=128)

    @model_validator(mode='before')
    @classmethod
    def preserve_legacy_identifier_fields(cls, value):
        if isinstance(value, dict) and 'identifier' not in value:
            if 'email' in value:
                normalize_identifier(value['email'])
            elif 'phone' in value:
                normalize_identifier(value['phone'])
        return value

    @field_validator('identifier')
    @classmethod
    def normalize(cls, value):
        return normalize_login_identifier(value)


class EmailRequest(Strict):
    email: str = Field(min_length=3, max_length=254)

    @field_validator('email')
    @classmethod
    def email_only(cls, value):
        value = normalize_identifier(value)
        if '@' not in value:
            raise ValueError('请输入邮箱，电话号码不能接收重置邮件')
        return value


class TokenRequest(Strict):
    token: str = Field(min_length=20, max_length=200)


class DesktopSyncInput(TokenRequest):
    revision: str | None = Field(default=None, max_length=64)
    pet_visible: bool = True


class PetPresenceInput(Strict):
    hidden: bool
    client_id: str = Field(default='legacy', min_length=1, max_length=64)


class DesktopPairingInput(TokenRequest):
    desktop_token: str | None = Field(default=None, min_length=20, max_length=200)


class ResetPassword(TokenRequest):
    password: str = Field(min_length=10, max_length=128)


class TaskFields(Strict):
    title: str = Field(min_length=1, max_length=500)
    notes: str = Field(default='', max_length=20000)
    scope: Scope = 'unassigned'
    status: Status = 'todo'
    priority: Priority = 'mid'
    parent_id: str | None = Field(default=None, max_length=36)
    project_id: str | None = Field(default=None, max_length=36)
    estimated_minutes: int | None = Field(default=None, ge=1, le=10080)
    due_date: date | None = None
    due_at: datetime | None = None
    due_timezone: str | None = None
    fail_reason: str = Field(default='', max_length=10000)
    hidden: bool = False

    @field_validator('title')
    @classmethod
    def nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('请输入任务名称')
        return v.strip()

    @model_validator(mode='after')
    def due_semantics(self):
        if self.due_date and self.due_at:
            raise ValueError('截止日期与精确时间只能选一种')
        if self.due_at:
            if self.due_at.tzinfo is None or not self.due_timezone:
                raise ValueError('精确时间必须提供偏移量与时区')
        if self.due_timezone:
            try:
                ZoneInfo(self.due_timezone)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError('无效时区')
        if not self.due_at and self.due_timezone:
            raise ValueError('只有精确时间需要截止时区')
        return self


class TaskUpdate(TaskFields):
    version: int = Field(ge=1)
    confirmed_failed_children: dict[str, int] | None = None


class VersionRequest(Strict):
    version: int = Field(ge=1)


class PlanRequest(Strict):
    task_id: str = Field(max_length=36)
    plan_date: date


class ImportRequest(Strict):
    content: str = Field(min_length=1, max_length=5_000_000)
    scope: Scope = 'unassigned'
