"""Database connection and session management."""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

# Fix DATABASE_URL for asyncpg compatibility
db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

engine_kwargs = {
    "echo": settings.DEBUG,
    "future": True,
}

if db_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_async_engine(db_url, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


async def get_db() -> AsyncSession:
    """Dependency to get database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database tables and add missing columns."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add meta_ig_account_id column if missing (create_all doesn't alter existing tables)
        try:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE users ADD COLUMN meta_ig_account_id VARCHAR(255)"
                )
            )
        except Exception:
            pass  # Column already exists
