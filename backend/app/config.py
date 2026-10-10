from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr, Field
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    database_url: str = 'postgresql+psycopg://todo_app:todo_app_local@127.0.0.1:25432/todo'
    migration_database_url: str = 'postgresql+psycopg://todo_owner:todo_owner_local@127.0.0.1:25432/todo'
    app_origin: str = 'http://localhost:5174'
    cookie_secure: bool = False
    smtp_host: str = '127.0.0.1'
    smtp_port: int = 21025
    smtp_from: str = 'todo@localhost.test'
    smtp_starttls: bool = False
    smtp_username: str = ''
    smtp_password: str = ''
    credential_key_file: str = '.runtime/credential.key'
    credential_master_key: str = ''
    article_sources_file: str = 'article-sources.json'
    news_search_provider: Literal['free', 'rss', 'bocha'] = 'free'
    bocha_search_api_key: SecretStr = SecretStr('')
    bocha_search_key_file: str = ''
    deletion_journal_file: str = '.runtime/deletion-journal.json'
    worker_discovery_database_url: str = ''
    system_embedding_api_key: SecretStr = SecretStr('')
    system_embedding_key_file: str = '.runtime/system-embedding.key'
    system_embedding_model: str = 'qwen3.7-text-embedding'
    system_embedding_region: Literal['cn', 'sg', 'us'] = 'cn'
    system_embedding_dimensions: int = Field(default=1024, ge=1, le=8192)


@lru_cache
def settings() -> Settings:
    return Settings()
