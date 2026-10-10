from collections.abc import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker, DeclarativeBase
from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings().database_url, pool_pre_ping=True, hide_parameters=True)
SessionFactory = sessionmaker(engine, expire_on_commit=False)


def database() -> Generator[Session, None, None]:
    with SessionFactory() as db, db.begin():
        yield db


def user_context(db: Session, user_id: str) -> None:
    # Transaction-local: no tenant context survives connection-pool reuse.
    db.execute(text("SELECT set_config('app.user_id', :user_id, true)"), {'user_id': user_id})
