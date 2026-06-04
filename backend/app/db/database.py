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

    # Sync PostgreSQL enum types with Python enum values
    try:
        async with engine.begin() as conn:
            # CampaignObjective enum
            for val in ['TRAFFIC', 'CONVERSIONS', 'PURCHASE', 'LEAD_GENERATION', 'AWARENESS', 'ENGAGEMENT', 'APP_PROMOTION']:
                try:
                    await conn.execute(
                        __import__('sqlalchemy').text(
                            f"ALTER TYPE campaignobjective ADD VALUE IF NOT EXISTS '{val}'"
                        )
                    )
                except Exception:
                    pass
            # CampaignStatus enum
            for val in ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED']:
                try:
                    await conn.execute(
                        __import__('sqlalchemy').text(
                            f"ALTER TYPE campaignstatus ADD VALUE IF NOT EXISTS '{val}'"
                        )
                    )
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Enum sync skipped (not PostgreSQL?): {e}")

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

    # Add send_hour / send_minute columns to scheduled_reports if missing
    for col, default in [("send_hour", 9), ("send_minute", 0)]:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE scheduled_reports ADD COLUMN {col} INTEGER DEFAULT {default}"
                    )
                )
        except Exception:
            pass  # Column already exists

    # Add targeting_segments column to campaigns if missing
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE campaigns ADD COLUMN targeting_segments TEXT"
                )
            )
    except Exception:
        pass  # Column already exists

    # Add meta_page_id and meta_pixel_id to users if missing
    for col in ["meta_page_id", "meta_pixel_id"]:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE users ADD COLUMN {col} VARCHAR(255)"
                    )
                )
        except Exception:
            pass

    # Add meta_dataset_id and default_currency to users if missing
    for col, col_type in [
        ("meta_dataset_id", "VARCHAR(255)"),
        ("default_currency", "VARCHAR(10) DEFAULT 'KRW'"),
    ]:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE users ADD COLUMN {col} {col_type}"
                    )
                )
        except Exception:
            pass

    # Add new campaign columns if missing
    campaign_cols = [
        ("budget_type", "VARCHAR(50) DEFAULT 'DAILY'"),
        ("currency", "VARCHAR(10) DEFAULT 'KRW'"),
        ("meta_adset_ids", "TEXT"),
        ("advantage_plus", "BOOLEAN DEFAULT FALSE"),
        ("dataset_id", "VARCHAR(255)"),
        ("pixel_id", "VARCHAR(255)"),
    ]
    for col, col_type in campaign_cols:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE campaigns ADD COLUMN {col} {col_type}"
                    )
                )
        except Exception:
            pass

    # Add days_of_week column to keyword_rank_schedules if missing
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE keyword_rank_schedules ADD COLUMN days_of_week VARCHAR(100)"
                )
            )
    except Exception:
        pass

    # Add width and height columns to creatives if missing
    for col in ["width", "height"]:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE creatives ADD COLUMN {col} INTEGER"
                    )
                )
        except Exception:
            pass

    # Create affiliate tables individually if create_all did not catch them
    affiliate_tables = [
        "affiliate_campaigns",
        "affiliate_partners",
        "referral_clicks",
        "referral_conversions",
        "affiliate_settlements",
        "referral_programs",
    ]
    for tbl_name in affiliate_tables:
        if tbl_name in Base.metadata.tables:
            try:
                async with engine.begin() as conn:
                    await conn.run_sync(
                        Base.metadata.tables[tbl_name].create, checkfirst=True
                    )
                logger.info(f"Ensured affiliate table: {tbl_name}")
            except Exception as te:
                logger.warning(f"Affiliate table {tbl_name} create skipped: {te}")

    # Add Naver advertising columns to users if missing
    naver_cols = [
        ("naver_search_ads_connected", "BOOLEAN DEFAULT FALSE"),
        ("naver_gfa_connected", "BOOLEAN DEFAULT FALSE"),
        ("naver_ads_customer_id", "VARCHAR(255)"),
    ]
    for col, col_type in naver_cols:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE users ADD COLUMN {col} {col_type}"
                    )
                )
        except Exception:
            pass

    # Phase 1 — Cafe24 OAuth + referral columns on users
    cafe24_user_cols = [
        ("cafe24_mall_id", "VARCHAR(100)"),
        ("cafe24_access_token", "TEXT"),
        ("cafe24_refresh_token", "TEXT"),
        ("cafe24_token_expires_at", "TIMESTAMP"),
        ("cafe24_scopes", "TEXT"),
        ("referral_code", "VARCHAR(20)"),
        ("referred_by_user_id", "INTEGER"),
    ]
    for col, col_type in cafe24_user_cols:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE users ADD COLUMN {col} {col_type}"
                    )
                )
        except Exception:
            pass

    # referral_code unique index on users
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_referral_code ON users(referral_code)"
                )
            )
    except Exception:
        pass

    # Phase 2 — AffiliateCampaign Cafe24 product/coupon columns
    campaign_cafe24_cols = [
        ("cafe24_product_no", "INTEGER"),
        ("cafe24_product_name", "VARCHAR(255)"),
        ("cafe24_product_image", "VARCHAR(500)"),
        ("cafe24_coupon_code", "VARCHAR(100)"),
        ("cafe24_coupon_no", "VARCHAR(100)"),
        ("discount_type", "VARCHAR(20)"),
        ("discount_value", "DOUBLE PRECISION"),
        ("base_product_url", "VARCHAR(500)"),
        ("referral_code", "VARCHAR(50)"),
    ]
    for col, col_type in campaign_cafe24_cols:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE affiliate_campaigns ADD COLUMN IF NOT EXISTS {col} {col_type}"
                    )
                )
            logger.info(f"[init_db] affiliate_campaigns.{col} ensured")
        except Exception as e:
            logger.warning(f"[init_db] affiliate_campaigns.{col} skipped: {e}")

    # cafe24_coupon_code index
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE INDEX IF NOT EXISTS ix_affiliate_campaigns_cafe24_coupon_code "
                    "ON affiliate_campaigns(cafe24_coupon_code)"
                )
            )
    except Exception:
        pass

    # Phase 6 — 비공개 카테고리 기반 다중 상품 캠페인 컬럼
    campaign_category_cols = [
        ("cafe24_category_no", "INTEGER"),
        ("cafe24_category_name", "VARCHAR(255)"),
        ("cafe24_product_nos", "TEXT"),
        ("cafe24_category_url", "VARCHAR(500)"),
    ]
    for col, col_type in campaign_category_cols:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE affiliate_campaigns ADD COLUMN IF NOT EXISTS {col} {col_type}"
                    )
                )
            logger.info(f"[init_db] affiliate_campaigns.{col} ensured")
        except Exception as e:
            logger.warning(f"[init_db] affiliate_campaigns.{col} skipped: {e}")
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE INDEX IF NOT EXISTS ix_affiliate_campaigns_cafe24_category_no "
                    "ON affiliate_campaigns(cafe24_category_no)"
                )
            )
    except Exception:
        pass

    # affiliate_partners deleted_at (soft delete)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE affiliate_partners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP"
                )
            )
    except Exception:
        pass
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE INDEX IF NOT EXISTS ix_affiliate_partners_deleted_at "
                    "ON affiliate_partners(deleted_at)"
                )
            )
    except Exception:
        pass

    # affiliate_partners channels column (multi-channel support)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE affiliate_partners ADD COLUMN channels TEXT"
                )
            )
    except Exception:
        pass  # Column already exists

    # affiliate_partners phone column
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE affiliate_partners ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"
                )
            )
        logger.info("[init_db] affiliate_partners.phone ensured")
    except Exception:
        pass  # Column already exists

    # affiliate_partners partner_group column — 활동 그룹 분류 (crew/gongu/ad/other)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE affiliate_partners ADD COLUMN IF NOT EXISTS "
                    "partner_group VARCHAR(20) DEFAULT 'crew'"
                )
            )
        logger.info("[init_db] affiliate_partners.partner_group ensured")
    except Exception:
        pass

    # Phase 3 — ReferralConversion cafe24_order_id
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "ALTER TABLE referral_conversions ADD COLUMN cafe24_order_id VARCHAR(100)"
                )
            )
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_referral_conversions_cafe24_order_id "
                    "ON referral_conversions(cafe24_order_id)"
                )
            )
    except Exception:
        pass

    # Phase 4 — point_transactions table
    for tbl_name in ["point_transactions", "partner_campaigns"]:
        if tbl_name in Base.metadata.tables:
            try:
                async with engine.begin() as conn:
                    await conn.run_sync(
                        Base.metadata.tables[tbl_name].create, checkfirst=True
                    )
                logger.info(f"Ensured table: {tbl_name}")
            except Exception as te:
                logger.warning(f"{tbl_name} create skipped: {te}")

    # Phase 6 — ReferralConversion status / refunded_amount / refunded_at
    for col, col_type in [
        ("status", "VARCHAR(20) DEFAULT 'paid'"),
        ("refunded_amount", "DOUBLE PRECISION DEFAULT 0"),
        ("refunded_at", "TIMESTAMP"),
    ]:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    __import__('sqlalchemy').text(
                        f"ALTER TABLE referral_conversions ADD COLUMN IF NOT EXISTS {col} {col_type}"
                    )
                )
            logger.info(f"[init_db] referral_conversions.{col} ensured")
        except Exception as e:
            logger.warning(f"[init_db] referral_conversions.{col} skipped: {e}")

    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    "CREATE INDEX IF NOT EXISTS ix_referral_conversions_status "
                    "ON referral_conversions(status)"
                )
            )
    except Exception:
        pass

    # Backfill: 기존 conversions의 NULL status를 'paid'로 보정
    try:
        async with engine.begin() as conn:
            result = await conn.execute(
                __import__('sqlalchemy').text(
                    "UPDATE referral_conversions SET status='paid' WHERE status IS NULL"
                )
            )
            if hasattr(result, 'rowcount') and result.rowcount and result.rowcount > 0:
                logger.info(f"[init_db] referral_conversions.status backfilled {result.rowcount} rows")
    except Exception as e:
        logger.warning(f"[init_db] status backfill skipped: {e}")

    # Backfill: affiliate_partners → partner_campaigns
    try:
        async with engine.begin() as conn:
            await conn.execute(
                __import__('sqlalchemy').text(
                    """
                    INSERT INTO partner_campaigns (partner_id, campaign_id, referral_code, referral_link, created_at)
                    SELECT id, campaign_id, referral_code, referral_link, COALESCE(created_at, NOW())
                    FROM affiliate_partners
                    WHERE campaign_id IS NOT NULL
                    ON CONFLICT DO NOTHING
                    """
                )
            )
    except Exception as be:
        logger.warning(f"partner_campaigns backfill skipped: {be}")
