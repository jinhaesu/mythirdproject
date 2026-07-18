"""마케팅 KPI 자동 수집기 — 네이버 검색광고 일별 광고비 + 카페24 일별 방문자수.

meta_insights_collector.py와 동일한 select-then-update upsert 패턴(PostgreSQL/SQLite 양쪽
호환)을 사용한다. app/main.py lifespan에서 run_kpi_collector_loop()를 asyncio task로 등록.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.kpi import ChannelSpendDaily, MallMember, MallOrder, MallVisitorsDaily
from app.services import cafe24 as cafe24_svc
from app.services.naver.search_ads_api import NaverSearchAdsAPI

logger = logging.getLogger(__name__)


# ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

def _parse_flexible_date(raw) -> Optional[date]:
    """"YYYYMMDD" / "YYYY-MM-DD" / ISO datetime 문자열을 방어적으로 date로 파싱."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # ISO 형태 (YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM:SS...)
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        pass
    # YYYYMMDD
    if len(s) == 8 and s.isdigit():
        try:
            return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
        except ValueError:
            return None
    return None


def _to_int(v) -> int:
    try:
        return int(float(v)) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def _to_float(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _chunk_date_range(since: date, until: date, max_days: int) -> List[Tuple[date, date]]:
    """[since, until]을 max_days 이하 청크로 분할."""
    chunks: List[Tuple[date, date]] = []
    cursor = since
    while cursor <= until:
        chunk_end = min(cursor + timedelta(days=max_days - 1), until)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def _chunk_date_range_monthly(since: date, until: date) -> List[Tuple[date, date]]:
    """[since, until]을 달력월 단위로 분할 (각 청크는 해당 월 내부로 클리핑)."""
    import calendar

    chunks: List[Tuple[date, date]] = []
    cursor = since
    while cursor <= until:
        last_day = calendar.monthrange(cursor.year, cursor.month)[1]
        month_end = date(cursor.year, cursor.month, last_day)
        chunk_end = min(month_end, until)
        chunks.append((cursor, chunk_end))
        # 다음 달 1일로 이동
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return chunks


# ── A. 네이버 검색광고 일별 광고비 ────────────────────────────────────────────

async def collect_naver_spend(db: AsyncSession, since: date, until: date) -> int:
    """네이버 검색광고 일별 총비용(salesAmt)을 수집해 ChannelSpendDaily(channel="naver_sa")에 upsert.

    31일 이하 청크로 나눠 /stats를 조회하고, 캠페인별 행을 날짜별로 합산한다.
    자격증명(NAVER_ADS_API_KEY/SECRET_KEY/CUSTOMER_ID) 미설정 시 0 반환 + log.

    Returns:
        upsert된 행 수 (날짜 단위)
    """
    settings = get_settings()
    if not (
        settings.NAVER_ADS_API_KEY
        and settings.NAVER_ADS_SECRET_KEY
        and settings.NAVER_ADS_CUSTOMER_ID
    ):
        logger.warning("[KPI Collector] Naver Search Ads 자격증명 미설정 — naver spend 수집 생략.")
        return 0

    if since > until:
        logger.warning(f"[KPI Collector] since({since}) > until({until}) — 수집 생략.")
        return 0

    client = NaverSearchAdsAPI(
        api_key=settings.NAVER_ADS_API_KEY,
        secret_key=settings.NAVER_ADS_SECRET_KEY,
        customer_id=settings.NAVER_ADS_CUSTOMER_ID,
    )

    try:
        campaign_ids = await client.get_campaign_ids()
    except Exception as e:
        logger.error(f"[KPI Collector] Naver 캠페인 목록 조회 실패: {e}")
        return 0

    if not campaign_ids:
        logger.warning("[KPI Collector] Naver 캠페인이 없습니다 — naver spend 수집 생략.")
        return 0

    spend_by_date: Dict[date, float] = defaultdict(float)

    for chunk_start, chunk_end in _chunk_date_range(since, until, max_days=31):
        try:
            rows = await client.get_stat_report(
                ids=campaign_ids,
                fields=["salesAmt"],
                date_preset="custom",
                time_increment="1",
                start_date=chunk_start.isoformat(),
                end_date=chunk_end.isoformat(),
            )
        except Exception as e:
            logger.error(
                f"[KPI Collector] Naver stat 조회 실패 {chunk_start}~{chunk_end}: {e}"
            )
            continue

        for row in rows or []:
            raw_date = (
                row.get("dateStart")
                or row.get("dateEnd")
                or row.get("statDt")
                or row.get("date")
            )
            row_date = _parse_flexible_date(raw_date)
            if not row_date:
                logger.warning(f"[KPI Collector] Naver stat 행 날짜 파싱 실패: {row}")
                continue
            spend_by_date[row_date] += _to_float(row.get("salesAmt"))

    upserted = 0
    for row_date, spend in spend_by_date.items():
        existing_q = await db.execute(
            select(ChannelSpendDaily).where(
                ChannelSpendDaily.date == row_date,
                ChannelSpendDaily.channel == "naver_sa",
            )
        )
        existing = existing_q.scalar_one_or_none()
        if existing:
            existing.spend = spend
        else:
            db.add(ChannelSpendDaily(date=row_date, channel="naver_sa", spend=spend))
        upserted += 1

    await db.commit()
    logger.info(
        f"[KPI Collector] Naver spend upsert 완료: {upserted}행 ({since}~{until})"
    )
    return upserted


# ── B. 카페24 방문자수 (Analytics API) ────────────────────────────────────────

async def collect_mall_visitors(db: AsyncSession, since: date, until: date) -> int:
    """카페24 Analytics API 일별 방문자수를 수집해 MallVisitorsDaily에 upsert.

    월 단위 청크로 get_visitors_daily 호출. Cafe24 연결 계정이 없으면 0 반환 + log.
    scope(mall.read_analytics) 미허용 등으로 get_visitors_daily가 예외를 던지면
    그대로 전파한다 (호출측 — /kpi/backfill-visitors 엔드포인트 — 가 400으로 변환).

    Returns:
        upsert된 행 수 (날짜 단위)
    """
    from app.api.v1.endpoints.auth import get_shared_cafe24_user

    cafe24_user = await get_shared_cafe24_user(db)
    if not cafe24_user:
        logger.warning("[KPI Collector] Cafe24 연결된 계정이 없습니다 — 방문자수 수집 생략.")
        return 0

    if since > until:
        logger.warning(f"[KPI Collector] since({since}) > until({until}) — 수집 생략.")
        return 0

    upserted = 0
    for chunk_start, chunk_end in _chunk_date_range_monthly(since, until):
        rows = await cafe24_svc.get_visitors_daily(cafe24_user, db, chunk_start, chunk_end)

        for row in rows or []:
            raw_date = (
                row.get("date")
                or row.get("stat_date")
                or row.get("visit_date")
                or row.get("regist_date")
            )
            row_date = _parse_flexible_date(raw_date)
            if not row_date:
                logger.warning(f"[KPI Collector] 방문자수 행 날짜 파싱 실패: {row}")
                continue

            visit_count = _to_int(row.get("visit_count") or row.get("visitCount"))
            first_visit_count = _to_int(row.get("first_visit_count") or row.get("firstVisitCount"))
            re_visit_count = _to_int(row.get("re_visit_count") or row.get("reVisitCount"))

            existing_q = await db.execute(
                select(MallVisitorsDaily).where(MallVisitorsDaily.date == row_date)
            )
            existing = existing_q.scalar_one_or_none()
            if existing:
                existing.visit_count = visit_count
                existing.first_visit_count = first_visit_count
                existing.re_visit_count = re_visit_count
            else:
                db.add(
                    MallVisitorsDaily(
                        date=row_date,
                        visit_count=visit_count,
                        first_visit_count=first_visit_count,
                        re_visit_count=re_visit_count,
                    )
                )
            upserted += 1

    await db.commit()
    logger.info(
        f"[KPI Collector] 방문자수 upsert 완료: {upserted}행 ({since}~{until})"
    )
    return upserted


# ── C. 카페24 회원 정보 (가입일시/성별/출생연도) ──────────────────────────────

def _parse_kst_datetime(raw) -> Optional[datetime]:
    """카페24 ISO(+09:00) 문자열 → KST naive datetime."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw)).replace(tzinfo=None)
    except ValueError:
        return None


def _parse_birthyear(raw) -> Optional[int]:
    """"YYYY-MM-DD" → 출생연도. 비정상 값(1900 이전/미래)은 None."""
    if not raw:
        return None
    try:
        y = int(str(raw)[:4])
    except ValueError:
        return None
    from datetime import date as _date
    return y if 1900 <= y <= _date.today().year else None


def _apply_member_row(existing: Optional[MallMember], member_id: str, row: dict, source: str) -> Optional[MallMember]:
    """카페24 응답 행을 MallMember에 반영. 새 행이면 인스턴스 반환(호출측 db.add), 갱신이면 None.

    privacy 소스가 customers 소스보다 정보가 많으므로(birthday) 덮어쓰되,
    반대 방향(customers가 privacy를 덮는 것)은 birthday를 None으로 지우지 않도록 필드별 병합.
    """
    joined_at = _parse_kst_datetime(row.get("created_date"))
    gender = row.get("gender") or None
    if gender not in ("M", "F"):
        gender = None
    birthyear = _parse_birthyear(row.get("birthday"))

    if existing:
        if joined_at:
            existing.joined_at = joined_at
        if gender:
            existing.gender = gender
        if birthyear:
            existing.birthyear = birthyear
            existing.source = "privacy" if source == "privacy" else existing.source
        if source == "privacy":
            existing.source = "privacy"
        existing.synced_at = datetime.utcnow()
        return None
    return MallMember(
        member_id=member_id,
        joined_at=joined_at,
        gender=gender,
        birthyear=birthyear,
        source=source,
        synced_at=datetime.utcnow(),
    )


async def sync_mall_members(db: AsyncSession, limit: int = 300) -> dict:
    """mall_orders에 등장하지만 mall_members에 없는 회원을 customers API로 보강.

    카페24 rate limit(버킷 40, 초당 2 리필)을 고려해 호출 간 0.4초 대기.
    Returns: {"enriched": n, "remaining": 남은 미보강 회원 수}
    """
    cafe24_user = await get_shared_cafe24_user_or_none(db)
    if not cafe24_user:
        logger.warning("[KPI Collector] Cafe24 연결 계정 없음 — 회원 동기화 생략.")
        return {"enriched": 0, "remaining": 0}

    known = select(MallMember.member_id)
    pending_rows = (
        await db.execute(
            select(MallOrder.member_id)
            .where(MallOrder.member_id.isnot(None), MallOrder.member_id.notin_(known))
            .group_by(MallOrder.member_id)
            .order_by(MallOrder.member_id)
            .limit(limit + 1)
        )
    ).scalars().all()

    has_more = len(pending_rows) > limit
    targets = pending_rows[:limit]
    enriched = 0
    for mid in targets:
        try:
            row = await cafe24_svc.get_customer(cafe24_user, db, mid)
        except Exception as e:
            logger.warning(f"[KPI Collector] 회원 조회 실패 {mid}: {e}")
            continue
        if row is None:
            # 탈퇴 등 조회 불가 — 빈 스텁 저장해서 재시도 루프 방지
            db.add(MallMember(member_id=mid, source="customers"))
            enriched += 1
            continue
        new_row = _apply_member_row(None, mid, row, "customers")
        if new_row:
            db.add(new_row)
        enriched += 1
        if enriched % 50 == 0:
            await db.commit()
        await asyncio.sleep(0.4)

    await db.commit()
    remaining_note = -1 if has_more else 0
    logger.info(f"[KPI Collector] 회원 동기화 완료: {enriched}명 보강 (더 남음: {has_more})")
    return {"enriched": enriched, "remaining": remaining_note}


async def backfill_members_privacy(db: AsyncSession, since: date, until: date) -> dict:
    """customersprivacy API로 가입일 범위 전체 회원(비구매자 포함) 백필.

    mall.read_privacy 스코프 재동의 후 사용 가능. 월 단위 청크 × offset 페이징.
    """
    cafe24_user = await get_shared_cafe24_user_or_none(db)
    if not cafe24_user:
        return {"upserted": 0, "error": "Cafe24 연결 계정 없음"}

    upserted = 0
    for chunk_start, chunk_end in _chunk_date_range_monthly(since, until):
        offset = 0
        while True:
            rows = await cafe24_svc.list_customersprivacy(
                cafe24_user, db,
                chunk_start.isoformat(), chunk_end.isoformat(),
                offset=offset, limit=100,
            )
            if not rows:
                break
            for row in rows:
                mid = row.get("member_id")
                if not mid:
                    continue
                existing = (
                    await db.execute(select(MallMember).where(MallMember.member_id == mid))
                ).scalar_one_or_none()
                new_row = _apply_member_row(existing, mid, row, "privacy")
                if new_row:
                    db.add(new_row)
                upserted += 1
            await db.commit()
            if len(rows) < 100:
                break
            offset += 100
            if offset > 20000:  # 방어적 상한 (월 2만명 초과 가입은 비정상)
                logger.warning(f"[KPI Collector] privacy 백필 offset 상한 도달: {chunk_start}")
                break
            await asyncio.sleep(0.4)

    logger.info(f"[KPI Collector] privacy 회원 백필 완료: {upserted}명 ({since}~{until})")
    return {"upserted": upserted}


async def get_shared_cafe24_user_or_none(db: AsyncSession):
    from app.api.v1.endpoints.auth import get_shared_cafe24_user

    return await get_shared_cafe24_user(db)


# ── 6시간 주기 수집 루프 ────────────────────────────────────────────────────

async def run_kpi_collector_loop() -> None:
    """6시간 주기 KPI 자동 수집 루프 — 최근 3일 naver spend + 최근 3일 방문자수.

    각각 독립적으로 try/except 처리 — 한쪽이 실패해도 다른 쪽은 계속 수집.
    """
    from app.db.database import AsyncSessionLocal

    logger.info("[KPI Collector] 수집 루프 시작 (6시간 주기)")

    while True:
        today = date.today()
        since = today - timedelta(days=3)

        try:
            async with AsyncSessionLocal() as db:
                n = await collect_naver_spend(db, since, today)
                logger.info(f"[KPI Collector] naver spend 수집 완료: {n}행")
        except Exception as e:
            logger.error(f"[KPI Collector] naver spend 수집 루프 에러: {e}", exc_info=True)

        try:
            async with AsyncSessionLocal() as db:
                v = await collect_mall_visitors(db, since, today)
                logger.info(f"[KPI Collector] 방문자수 수집 완료: {v}행")
        except Exception as e:
            logger.error(f"[KPI Collector] 방문자수 수집 루프 에러: {e}", exc_info=True)

        try:
            async with AsyncSessionLocal() as db:
                m = await sync_mall_members(db, limit=300)
                logger.info(f"[KPI Collector] 회원 동기화 완료: {m}")
        except Exception as e:
            logger.error(f"[KPI Collector] 회원 동기화 루프 에러: {e}", exc_info=True)

        await asyncio.sleep(6 * 3600)
