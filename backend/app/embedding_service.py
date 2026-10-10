"""Operator credential stays outside tenant records and public model connections."""
from dataclasses import dataclass, field
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import select
from .config import settings
from .advanced_models import EmbeddingProfile, ProviderConnection
from .models import User
from .common import preferences, enqueue, today, private_owned, tenant_session
from .providers import cipher


@dataclass(frozen=True)
class SystemConnection:
    ciphertext: str = field(repr=False)
    region: str
    dimensions: int
    provider: str = 'bailian'
    enabled: bool = True
    managed: bool = True


def system_configured():
    config = settings()
    return bool(config.system_embedding_api_key.get_secret_value() or
        (config.system_embedding_key_file and Path(config.system_embedding_key_file).is_file()))


def system_connection(dimensions=None):
    config = settings()
    raw = config.system_embedding_api_key.get_secret_value()
    if raw:
        encrypted = cipher().encrypt(raw.encode()).decode()
    elif config.system_embedding_key_file and Path(config.system_embedding_key_file).is_file():
        try:
            encrypted = Path(config.system_embedding_key_file).read_text(encoding='ascii').strip()
        except (OSError, UnicodeError):
            raise HTTPException(503, '系统历史搜索服务暂时不可用') from None
    else:
        raise HTTPException(503, '系统历史搜索服务尚未配置')
    return SystemConnection(encrypted, config.system_embedding_region, dimensions or config.system_embedding_dimensions)


def profile_connection(db, user_id, profile):
    if profile.connection_id is None:
        return system_connection(profile.dimensions)
    return private_owned(db, ProviderConnection, user_id, profile.connection_id)


def ensure_system_profile(db, user_id):
    if not system_configured():
        return None
    config = settings()
    preferences(db, user_id, True)  # One user lock serializes API and worker initialization.
    profile = db.scalar(select(EmbeddingProfile).where(EmbeddingProfile.user_id == user_id,
        EmbeddingProfile.connection_id.is_(None), EmbeddingProfile.model == config.system_embedding_model,
        EmbeddingProfile.dimensions == config.system_embedding_dimensions).order_by(EmbeddingProfile.id).limit(1))
    if profile is None:
        profile = EmbeddingProfile(user_id=user_id, connection_id=None,
            model=config.system_embedding_model, dimensions=config.system_embedding_dimensions)
        db.add(profile)
        db.flush()
    profile.active = True
    if profile.state != 'failed':
        # Retry on the next day after a prolonged outage; repeated page loads coalesce.
        enqueue(db, user_id, 'embedding', f'embedding:{profile.id}:system:{today(db.get(User,user_id))}', {'profile_id': profile.id})
    return profile


def initialized_system_profile(user_id):
    # Commit initialization before a search reserves metered usage in another session.
    with tenant_session(user_id) as db:
        return ensure_system_profile(db, user_id)
