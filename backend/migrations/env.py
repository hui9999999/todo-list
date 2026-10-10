from alembic import context
from sqlalchemy import create_engine
from app.config import settings
from app.db import Base
from app import models  # noqa: F401
from app import advanced_models  # noqa: F401
from app import persona  # noqa: F401

config = context.config
if context.is_offline_mode():
    context.configure(url=settings().migration_database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(settings().migration_database_url).connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
