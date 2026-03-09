"""Database connection and session management."""
import logging

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

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
    # Ensure all models are registered with Base.metadata before create_all
    import app.models  # noqa: F401

    table_names = list(Base.metadata.tables.keys())
    logger.info(f"Registered models: {table_names}")

    # Try create_all first
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("create_all completed successfully")
    except Exception as e:
        logger.warning(f"create_all failed, trying individual tables: {e}")
        # Fallback: create each table individually
        for table in Base.metadata.sorted_tables:
            try:
                async with engine.begin() as conn:
                    await conn.run_sync(table.create, checkfirst=True)
                logger.info(f"Created table: {table.name}")
            except Exception as te:
                logger.warning(f"Table {table.name} already exists or error: {te}")

    # Add meta_ig_account_id column if missing (create_all doesn't alter existing tables)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE users ADD COLUMN meta_ig_account_id VARCHAR(255)"
                )
            )
    except Exception:
        pass  # Column already exists

    # Add send_hour column to scheduled_reports if missing
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE scheduled_reports ADD COLUMN send_hour INTEGER DEFAULT 9"
                )
            )
    except Exception:
        pass  # Column already exists
