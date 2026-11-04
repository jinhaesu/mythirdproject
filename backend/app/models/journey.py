"""자사몰(nuldam.com) 페이지 여정·상세 스크롤 추적 (2026-11-04 대표 요청).

tracker.js(카페24 ScriptTags로 전 페이지 설치)가 페이지를 열 때마다 한 줄(kind='pv'),
상세에서 담기·구매 버튼을 누르면 한 줄(kind='cart_click'|'buy_click')을 남긴다.
페이지를 떠날 때 같은 pv 줄에 머문 시간·상세 설명을 어디까지 봤는지(desc_pct)를 덧쓴다.

개인정보 없음: 방문자·방문(세션) 아이디는 브라우저가 만든 무작위 값이다.
주문번호는 주문완료 페이지에서만 받고, 신규/재구매 구분은 서버가 mall_orders와 맞춰 본다.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MallJourneyEvent(Base):
    __tablename__ = "mall_journey_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pvid: Mapped[str] = mapped_column(String(24), unique=True, index=True)  # 이 줄의 아이디
    kind: Mapped[str] = mapped_column(String(12), default="pv")  # pv | cart_click | buy_click
    ref_pv: Mapped[Optional[str]] = mapped_column(String(24), nullable=True, index=True)  # 클릭이 일어난 페이지의 pvid
    vid: Mapped[str] = mapped_column(String(24), index=True)  # 방문자(브라우저) — 400일 쿠키+localStorage
    sid: Mapped[str] = mapped_column(String(24), index=True)  # 방문(세션) — 30분 쉬면 새 방문
    sn: Mapped[int] = mapped_column(Integer, default=1)  # 이 방문자의 몇 번째 방문인지 (1 = 첫 방문)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)  # UTC
    host: Mapped[str] = mapped_column(String(60), default="")
    path: Mapped[str] = mapped_column(String(300), default="")  # 경로 + 허용한 쿼리(product_no·cate_no·order_id·utm)만
    page_type: Mapped[str] = mapped_column(String(12), default="other")  # main|list|search|detail|cart|order|done|…
    product_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    order_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    referrer: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # 앞 페이지 도메인(외부 유입 출처)
    utm_source: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    device: Mapped[str] = mapped_column(String(4), default="m")  # m | pc
    # 상세 스크롤 (상세 페이지만). 운영 화면은 설명(#prdDetail)이 약 840px로 접혀 있고 '펼치기'를 눌러야 다 보인다.
    page_pct: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 페이지 전체에서 내려 본 깊이 0~100(5 단위)
    section: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 화면에 들어온 가장 아래 구역 0사진·가격 1설명 2정보고시 3리뷰 4문의
    expanded: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # 설명을 펼쳤나
    desc_pct: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 펼친 설명 안에서 본 깊이 -1(설명 전)~100, 안 펼쳤으면 None
    dwell_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 화면이 보이던 시간

    __table_args__ = (
        Index("ix_mall_journey_type_ts", "page_type", "ts"),
        Index("ix_mall_journey_sid_ts", "sid", "ts"),
    )
