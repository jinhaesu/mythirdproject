"""어필리에이트 파트너·캠페인 목록 묶음 질의 (2026-11-10 이은주 건의 4afe1bf7 — 어필리에이트 운영 로딩 느림).

예전엔 파트너·캠페인마다 집계 질의를 따로 돌렸다(파트너 수백 명 → 질의 천여 번).
묶음 질의로 바꾼 뒤에도 응답이 예전과 똑같은지, 예전 코드를 그대로 옮겨 와 같은 데이터로 비교한다.
DB는 SQLite 메모리(운영 DB 안 씀).
"""
import asyncio
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import affiliate as aff
from app.db.database import Base
from app.models.affiliate import (
    AffiliateCampaign, AffiliatePartner, AffiliateSettlement, ReferralClick, ReferralConversion,
)
from app.models.partner_campaign import PartnerCampaign
from app.models.user import User


# ─── 예전 코드(파트너·캠페인마다 질의) 그대로 ─────────────────────────────────

async def _old_partners(db, current_user, campaign_id=None, status=None):
    query = select(AffiliatePartner).where(AffiliatePartner.deleted_at.is_(None))
    if campaign_id is not None:
        query = query.where(AffiliatePartner.campaign_id == campaign_id)
    if status is not None:
        query = query.where(AffiliatePartner.status == status)
    partners = (await db.execute(query)).scalars().all()
    response = []
    for p in partners:
        d = aff._partner_to_dict(p)
        clicks = (await db.execute(select(func.count(ReferralClick.id)).where(ReferralClick.partner_id == p.id))).scalar() or 0
        conv_row = (await db.execute(select(
            func.count(ReferralConversion.id),
            func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            func.coalesce(func.sum(ReferralConversion.commission_amount), 0),
        ).where(ReferralConversion.partner_id == p.id, ReferralConversion.status == "paid", aff.CONFIRMED_ATTR))).one()
        paid = float((await db.execute(select(func.coalesce(func.sum(AffiliateSettlement.amount), 0)).where(
            AffiliateSettlement.partner_id == p.id, AffiliateSettlement.status == "paid"))).scalar() or 0)
        conversions = conv_row[0] or 0
        d["click_count"] = clicks
        d["conversion_count"] = conversions
        d["total_sales"] = float(conv_row[1])
        d["total_commission"] = float(conv_row[2])
        d["unpaid_commission"] = max(0.0, float(conv_row[2]) - paid)
        d["conversion_rate"] = round((conversions / clicks * 100) if clicks > 0 else 0.0, 2)
        pcs = list((await db.execute(select(PartnerCampaign).where(PartnerCampaign.partner_id == p.id))).scalars().all())
        seen = {pc.campaign_id for pc in pcs}
        links = []
        for pc in pcs:
            camp = (await db.execute(select(AffiliateCampaign).where(AffiliateCampaign.id == pc.campaign_id))).scalar_one_or_none()
            links.append({"pc_id": pc.id, "campaign_id": pc.campaign_id, "campaign_name": camp.name if camp else "",
                          "referral_code": pc.referral_code,
                          "referral_link": aff._build_referral_link(camp, pc.referral_code, current_user) if camp else pc.referral_link})
        if p.campaign_id and p.campaign_id not in seen:
            camp = (await db.execute(select(AffiliateCampaign).where(AffiliateCampaign.id == p.campaign_id))).scalar_one_or_none()
            links.append({"pc_id": -1, "campaign_id": p.campaign_id, "campaign_name": camp.name if camp else "",
                          "referral_code": p.referral_code,
                          "referral_link": aff._build_referral_link(camp, p.referral_code, current_user) if camp else p.referral_link})
        d["campaign_links"] = links
        response.append(d)
    return response


async def _old_campaigns(db, current_user):
    campaigns = (await db.execute(select(AffiliateCampaign))).scalars().all()
    active = [r[0] for r in (await db.execute(select(AffiliatePartner.id).where(AffiliatePartner.deleted_at.is_(None)))).all()]
    response = []
    for c in campaigns:
        d = aff._campaign_to_dict(c, current_user)
        pc_n = (await db.execute(select(func.count(func.distinct(PartnerCampaign.partner_id))).where(
            PartnerCampaign.campaign_id == c.id, PartnerCampaign.partner_id.in_(active) if active else False))).scalar() or 0
        legacy_n = (await db.execute(select(func.count(AffiliatePartner.id)).where(
            AffiliatePartner.campaign_id == c.id, AffiliatePartner.deleted_at.is_(None)))).scalar() or 0
        cc = [ReferralClick.campaign_id == c.id]
        vc = [ReferralConversion.campaign_id == c.id, ReferralConversion.status == "paid", aff.CONFIRMED_ATTR]
        if active:
            cc.append(ReferralClick.partner_id.in_(active))
            vc.append(ReferralConversion.partner_id.in_(active))
        clicks = (await db.execute(select(func.count(ReferralClick.id)).where(*cc))).scalar() or 0
        conv_row = (await db.execute(select(
            func.count(ReferralConversion.id),
            func.coalesce(func.sum(ReferralConversion.order_amount), 0),
            func.coalesce(func.sum(ReferralConversion.commission_amount), 0)).where(*vc))).one()
        conversions = conv_row[0] or 0
        d["partner_count"] = pc_n + legacy_n
        d["click_count"] = clicks
        d["conversion_count"] = conversions
        d["total_sales"] = float(conv_row[1])
        d["total_commission"] = float(conv_row[2])
        d["conversion_rate"] = round((conversions / clicks * 100) if clicks > 0 else 0.0, 2)
        response.append(d)
    return response


# ─── 시험 데이터 ──────────────────────────────────────────────────────────────

async def _setup(seed=True):
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=[
            User.__table__, AffiliateCampaign.__table__, AffiliatePartner.__table__, ReferralClick.__table__,
            ReferralConversion.__table__, AffiliateSettlement.__table__, PartnerCampaign.__table__])
    user = User(id=1, email="tester@example.com")
    async with Session() as s:
        s.add(user)
        if seed:
            s.add_all([AffiliateCampaign(id=i, user_id=1, name=f"캠{i}", referral_code=f"C{i}") for i in (1, 2, 3)])
            await s.flush()
            # 1·2: 다캠페인 파트너 / 3: 옛 campaign_id만 / 4: 휴지통 / 5: 아무 기록 없음 / 6: 없는 캠페인을 가리키는 옛 값
            s.add_all([
                AffiliatePartner(id=1, user_id=1, name="가", referral_code="P1", status="approved"),
                AffiliatePartner(id=2, user_id=1, name="나", referral_code="P2", status="pending", campaign_id=1),
                AffiliatePartner(id=3, user_id=1, name="다", referral_code="P3", status="approved", campaign_id=2),
                AffiliatePartner(id=4, user_id=1, name="라", referral_code="P4", status="approved", campaign_id=1,
                                 deleted_at=datetime(2026, 10, 1)),
                AffiliatePartner(id=5, user_id=1, name="마", referral_code="P5", status="approved"),
                AffiliatePartner(id=6, user_id=1, name="바", referral_code="P6", status="approved", campaign_id=3,
                                 referral_link="https://legacy"),
            ])
            await s.flush()
            s.add_all([
                PartnerCampaign(id=10, partner_id=1, campaign_id=2, referral_code="P1-2"),
                PartnerCampaign(id=11, partner_id=1, campaign_id=1, referral_code="P1-1"),
                PartnerCampaign(id=12, partner_id=2, campaign_id=1, referral_code="P2-1"),
                PartnerCampaign(id=13, partner_id=4, campaign_id=2, referral_code="P4-2"),
            ])
            clicks = [(1, 1)] * 5 + [(1, 2)] * 3 + [(2, 1)] * 4 + [(3, 2)] * 2 + [(4, 2)] * 6 + [(6, None)] * 2
            s.add_all([ReferralClick(partner_id=p, campaign_id=c) for p, c in clicks])
            convs = [  # partner, campaign, amount, commission, status, source
                (1, 1, 10000, 1000, "paid", "bind"), (1, 2, 20000, 2000, "paid", "ref"),
                (1, 1, 5000, 500, "paid", None),  # 추정(라스트클릭) — 집계 제외
                (2, 1, 8000, 800, "refunded", "bind"),  # 환불 — 제외
                (2, 1, 3000, 300, "paid", "coupon"), (3, 2, 7000, 700, "paid", "member"),
                (4, 2, 9999, 999, "paid", "bind"),  # 휴지통 파트너
            ]
            s.add_all([ReferralConversion(partner_id=p, campaign_id=c, order_amount=a, commission_amount=m,
                                          status=st, attribution_source=src) for p, c, a, m, st, src in convs])
            s.add_all([AffiliateSettlement(partner_id=1, user_id=1, amount=1500, status="paid"),
                       AffiliateSettlement(partner_id=1, user_id=1, amount=9000, status="pending"),
                       AffiliateSettlement(partner_id=3, user_id=1, amount=5000, status="paid")])  # 3: 받은 것보다 많이 정산
        await s.commit()
    return Session, user, engine


def _run(coro):
    return asyncio.run(coro)


def test_partners_same_as_before():
    async def go():
        Session, user, engine = await _setup()
        async with Session() as db:
            for kw in ({}, {"campaign_id": 1}, {"status": "approved"}, {"campaign_id": 99}):
                new = await aff.list_partners(current_user=user, db=db, campaign_id=kw.get("campaign_id"), status=kw.get("status"))
                old = await _old_partners(db, user, **kw)
                assert new == old, kw
            rows = {r["id"]: r for r in await aff.list_partners(current_user=user, db=db, campaign_id=None, status=None)}
        assert 4 not in rows
        assert rows[1]["click_count"] == 8 and rows[1]["conversion_count"] == 2 and rows[1]["total_sales"] == 30000.0
        assert rows[1]["unpaid_commission"] == 1500.0  # 3,000 − 지급 1,500 (대기 9,000은 안 뺌)
        assert [l["pc_id"] for l in rows[1]["campaign_links"]] == [10, 11]
        assert rows[3]["unpaid_commission"] == 0.0 and rows[3]["campaign_links"][0]["pc_id"] == -1
        assert rows[5]["click_count"] == 0 and rows[5]["conversion_rate"] == 0.0 and rows[5]["campaign_links"] == []
        assert rows[6]["campaign_links"][0]["campaign_name"] == "캠3"
        await engine.dispose()
    _run(go())


def test_campaigns_same_as_before():
    async def go():
        Session, user, engine = await _setup()
        async with Session() as db:
            new = await aff.list_campaigns(current_user=user, db=db)
            old = await _old_campaigns(db, user)
        assert new == old
        by = {c["id"]: c for c in new}
        assert by[1]["partner_count"] == 2 + 1  # 연결 1·2 + 옛 값 2 (휴지통 4 제외)
        assert by[2]["click_count"] == 5 and by[2]["conversion_count"] == 2  # 휴지통 4의 클릭·전환 제외
        await engine.dispose()
    _run(go())


def test_empty():
    async def go():
        Session, user, engine = await _setup(seed=False)
        async with Session() as db:
            assert await aff.list_partners(current_user=user, db=db, campaign_id=None, status=None) == []
            assert await aff.list_campaigns(current_user=user, db=db) == []
        await engine.dispose()
    _run(go())
