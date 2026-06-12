"""Meta 광고 인사이트 수집기 — 스냅샷 + 온디맨드 하이브리드.

전략:
  - DB가 비어있으면 최근 90일 백필
  - 이후 매 실행마다 최근 7일을 재수집(upsert) → Meta 어트리뷰션 지연 보정
  - campaign 레벨, time_increment=1 (일별)
  - upsert: (ad_account_id, level, object_id, date) 기준 select-then-update 방식
            → PostgreSQL / SQLite 모두 호환
"""
import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── 전역 수집 상태 ──────────────────────────────────────────────────────────
collector_state: Dict[str, Any] = {
    "as_of": None,          # 마지막 성공 수집 ISO timestamp (str|None)
    "token_expired": False, # Meta 에러 코드 190 감지 시 True
    "last_error": None,     # 마지막 에러 메시지 (str|None)
    "running": False,       # 현재 수집 중 여부
}


# ── Meta API 헬퍼 ────────────────────────────────────────────────────────────

async def _meta_get(access_token: str, endpoint: str, params: Dict[str, Any]) -> Dict:
    """Meta Graph API GET 요청. 에러 코드 190(토큰 만료) 감지 후 전파."""
    params = dict(params)
    params["access_token"] = access_token
    base = f"{settings.META_GRAPH_API_BASE}/{settings.META_API_VERSION}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(f"{base}/{endpoint}", params=params)
        body = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Meta API 요청 실패: {endpoint} → {exc}") from exc

    # 에러 처리
    error = body.get("error", {})
    if error:
        code = error.get("code")
        if code == 190:
            # 토큰 만료 — 전역 상태에 기록 후 예외 발생
            collector_state["token_expired"] = True
            raise RuntimeError(f"Meta 토큰 만료(190): {error.get('message', '')}")
        raise RuntimeError(f"Meta API 에러 {code}: {error.get('message', '')}")

    return body


async def _fetch_campaign_insights_for_range(
    access_token: str,
    ad_account_id: str,
    since: str,
    until: str,
) -> List[Dict]:
    """지정된 날짜 범위의 campaign 레벨 일별 인사이트를 전체 페이지 수집."""
    fields = (
        "campaign_id,campaign_name,"
        "spend,impressions,clicks,reach,frequency,"
        "actions,action_values"
    )
    params: Dict[str, Any] = {
        "level": "campaign",
        "fields": fields,
        "time_increment": "1",
        "time_range": f'{{"since":"{since}","until":"{until}"}}',
        "limit": 500,
    }

    all_rows: List[Dict] = []
    endpoint = f"{ad_account_id}/insights"

    while True:
        body = await _meta_get(access_token, endpoint, params)
        rows = body.get("data", [])
        all_rows.extend(rows)

        # 페이징 — paging.next 있으면 계속
        paging = body.get("paging", {})
        next_url = paging.get("next")
        if not next_url:
            break

        # next URL 에서 파라미터 추출 (after cursor 방식)
        cursors = paging.get("cursors", {})
        after = cursors.get("after")
        if not after:
            # next URL 에서 after 파라미터를 직접 파싱
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(next_url)
            qs = parse_qs(parsed.query)
            after_list = qs.get("after", [])
            if not after_list:
                break
            after = after_list[0]

        params = {
            "level": "campaign",
            "fields": fields,
            "time_increment": "1",
            "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "limit": 500,
            "after": after,
        }

    return all_rows


# ── 지표 파싱 헬퍼 ───────────────────────────────────────────────────────────

def _parse_actions(actions: Optional[List[Dict]], action_values: Optional[List[Dict]]) -> tuple:
    """actions/action_values 리스트에서 구매수·구매전환값 추출.

    Returns:
        (conversions: float, revenue: float)
    """
    purchase_types = {"purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"}

    conversions = 0.0
    revenue = 0.0

    for a in (actions or []):
        if a.get("action_type") in purchase_types:
            conversions += float(a.get("value", 0) or 0)

    for av in (action_values or []):
        if av.get("action_type") in purchase_types:
            revenue += float(av.get("value", 0) or 0)

    return conversions, revenue


# ── 핵심 수집 함수 ───────────────────────────────────────────────────────────

async def collect_insights(db: AsyncSession) -> int:
    """공유 Meta 자격증명으로 campaign 레벨 일별 인사이트 수집·upsert.

    Returns:
        upsert된 행 수
    """
    from app.models.user import User
    from app.models.meta_insight import MetaInsightDaily

    # ── 공유 Meta 자격증명 조회 ──
    result = await db.execute(
        select(User).where(
            User.meta_access_token.isnot(None),
            User.meta_access_token != "",
        ).limit(1)
    )
    meta_user: Optional[User] = result.scalar_one_or_none()
    if not meta_user or not meta_user.meta_access_token:
        logger.warning("[MetaInsights] Meta 자격증명이 없습니다. 수집 생략.")
        return 0

    access_token = meta_user.meta_access_token
    ad_account_id = meta_user.meta_ad_account_id or ""
    if ad_account_id and not ad_account_id.startswith("act_"):
        ad_account_id = f"act_{ad_account_id}"
    if not ad_account_id:
        logger.warning("[MetaInsights] ad_account_id 가 비어있습니다. 수집 생략.")
        return 0

    # ── 백필 vs 증분 범위 결정 ──
    count_result = await db.execute(
        select(func.count()).select_from(MetaInsightDaily).where(
            MetaInsightDaily.ad_account_id == ad_account_id
        )
    )
    existing_count = count_result.scalar() or 0

    today = date.today()
    if existing_count == 0:
        # 최초 실행: 90일 백필
        since = (today - timedelta(days=90)).isoformat()
        until = today.isoformat()
        logger.info(f"[MetaInsights] DB 비어있음 → 90일 백필: {since} ~ {until}")
    else:
        # 이후 실행: 최근 7일 재수집 (어트리뷰션 지연 보정)
        since = (today - timedelta(days=7)).isoformat()
        until = today.isoformat()
        logger.info(f"[MetaInsights] 증분 수집(7일): {since} ~ {until}")

    # ── Meta API 호출 ──
    try:
        rows = await _fetch_campaign_insights_for_range(access_token, ad_account_id, since, until)
    except RuntimeError as exc:
        logger.error(f"[MetaInsights] 수집 실패: {exc}")
        collector_state["last_error"] = str(exc)
        raise

    logger.info(f"[MetaInsights] Meta API 응답 행 수: {len(rows)}")

    # ── Upsert ──
    now = datetime.utcnow()
    upserted = 0

    for row in rows:
        campaign_id: str = row.get("campaign_id", "")
        campaign_name: str = row.get("campaign_name", "")
        date_str: str = row.get("date_start", "")
        if not date_str:
            continue

        try:
            row_date = date.fromisoformat(date_str)
        except ValueError:
            logger.warning(f"[MetaInsights] 날짜 파싱 실패: {date_str}")
            continue

        conversions, revenue = _parse_actions(
            row.get("actions"),
            row.get("action_values"),
        )

        # select-then-update (PostgreSQL/SQLite 양쪽 호환)
        existing_q = await db.execute(
            select(MetaInsightDaily).where(
                MetaInsightDaily.ad_account_id == ad_account_id,
                MetaInsightDaily.level == "campaign",
                MetaInsightDaily.object_id == campaign_id,
                MetaInsightDaily.date == row_date,
            )
        )
        existing = existing_q.scalar_one_or_none()

        if existing:
            existing.object_name = campaign_name
            existing.campaign_name = campaign_name
            existing.spend = float(row.get("spend", 0) or 0)
            existing.impressions = int(float(row.get("impressions", 0) or 0))
            existing.clicks = int(float(row.get("clicks", 0) or 0))
            existing.reach = int(float(row.get("reach", 0) or 0))
            existing.frequency = float(row.get("frequency", 0) or 0)
            existing.conversions = conversions
            existing.revenue = revenue
            existing.collected_at = now
        else:
            insight = MetaInsightDaily(
                ad_account_id=ad_account_id,
                level="campaign",
                object_id=campaign_id,
                object_name=campaign_name,
                campaign_id=campaign_id,
                campaign_name=campaign_name,
                date=row_date,
                spend=float(row.get("spend", 0) or 0),
                impressions=int(float(row.get("impressions", 0) or 0)),
                clicks=int(float(row.get("clicks", 0) or 0)),
                reach=int(float(row.get("reach", 0) or 0)),
                frequency=float(row.get("frequency", 0) or 0),
                conversions=conversions,
                revenue=revenue,
                collected_at=now,
            )
            db.add(insight)

        upserted += 1

    await db.commit()
    logger.info(f"[MetaInsights] upsert 완료: {upserted}행")

    # ── 전역 상태 갱신 ──
    collector_state["as_of"] = now.isoformat()
    collector_state["token_expired"] = False
    collector_state["last_error"] = None

    # ── 알람 모듈 호출 (다른 에이전트가 작성; ImportError/Exception 는 log 만) ──
    try:
        from app.services.insight_alerts import evaluate_insight_alerts  # type: ignore
        await evaluate_insight_alerts(db)
    except (ImportError, Exception) as exc:
        logger.debug(f"[MetaInsights] insight_alerts 스킵: {exc}")

    return upserted


# ── 1시간 주기 루프 ──────────────────────────────────────────────────────────

async def run_collector_loop() -> None:
    """1시간 주기 Meta 인사이트 수집 루프.

    - 시작 즉시 1회 실행
    - 예외 발생 시 log + collector_state.last_error 기록 후 루프 계속
    """
    from app.db.database import AsyncSessionLocal

    logger.info("[MetaInsights] 수집 루프 시작 (1시간 주기)")

    while True:
        collector_state["running"] = True
        try:
            async with AsyncSessionLocal() as db:
                await collect_insights(db)
        except Exception as exc:
            collector_state["last_error"] = str(exc)
            logger.error(f"[MetaInsights] 루프 에러: {exc}", exc_info=True)
        finally:
            collector_state["running"] = False

        # 1시간 대기
        await asyncio.sleep(3600)
