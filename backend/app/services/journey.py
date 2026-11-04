"""자사몰 여정·상세 스크롤 — 주소 분류와 집계(순수 함수, DB 없이 시험 가능).

여정 단계(방문 한 번 = 세션 기준, 그 세션이 도달한 가장 깊은 단계로 센다):
  0 방문 → 1 상품 상세 → 2 담기·구매 버튼(또는 장바구니) → 3 주문서 → 4 결제 완료
'바로 구매'는 장바구니를 건너뛰므로 2단계에 장바구니 페이지와 버튼 클릭을 함께 넣었다.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median
from typing import Iterable, Optional
from urllib.parse import parse_qs, unquote

KST = timedelta(hours=9)

PAGE_LABEL = {
    "main": "메인",
    "list": "상품 목록·기획전",
    "search": "검색",
    "detail": "상품 상세",
    "cart": "장바구니",
    "order": "주문서",
    "done": "결제 완료",
    "member": "로그인·회원",
    "myshop": "마이쇼핑",
    "brand": "브랜드 페이지",
    "board": "게시판·리뷰",
    "other": "기타",
}

STAGES = [
    ("visit", "방문"),
    ("detail", "상품 상세"),
    ("intent", "담기·구매 버튼"),
    ("order", "주문서"),
    ("done", "결제 완료"),
]

_RANK = {"detail": 1, "cart": 2, "cart_click": 2, "buy_click": 2, "order": 3, "done": 4}

KEEP_QS = ("product_no", "cate_no", "order_id", "utm_source", "utm_medium", "utm_campaign")

_RE_ID = re.compile(r"^[0-9a-f]{24}$")
_RE_ORDER = re.compile(r"^20\d{6}-\d{7}$")
_RE_BOT = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|yeti|daum", re.I)


def is_id(v) -> bool:
    return isinstance(v, str) and bool(_RE_ID.match(v))


def is_bot(ua: str) -> bool:
    return bool(_RE_BOT.search(ua or ""))


def classify(url: str) -> tuple[str, Optional[int], Optional[int], Optional[str]]:
    """'/product/detail.html?product_no=12' → ('detail', 12, None, None).

    돌려주는 값: (페이지 유형, 상품번호, 분류번호, 주문번호). 카페24 SEO 주소(/product/이름/12/…),
    짧은 주소(/surl/P/12), 미리보기 접두(/skin-skin13/)도 처리한다.
    """
    raw = (url or "").strip()
    path, _, query = raw.partition("?")
    q = parse_qs(query) if query else {}

    def qint(k):
        try:
            return int(q[k][0])
        except (KeyError, ValueError, IndexError):
            return None

    p = unquote(path).lower()
    p = re.sub(r"^/skin-(skin|mobile)\d*", "", p) or "/"
    prod, cate = qint("product_no"), qint("cate_no")
    order = None
    if q.get("order_id") and _RE_ORDER.match(q["order_id"][0]):
        order = q["order_id"][0]

    if p in ("/", "/index.html", "/main.html"):
        return "main", None, None, None
    m = re.match(r"^/product/[^/]+/(\d+)(?:/|$)", p) or re.match(r"^/surl/p/(\d+)", p)
    if p.startswith("/product/detail.html") or m:
        if m and prod is None:
            prod = int(m.group(1))
        return "detail", prod, cate, None
    if p.startswith("/product/search.html"):
        return "search", None, None, None
    m = re.match(r"^/category/[^/]+/(\d+)", p) or re.match(r"^/surl/c/(\d+)", p)
    if p.startswith(("/product/list.html", "/product/project.html", "/category/")) or m:
        if m and cate is None:
            cate = int(m.group(1))
        return "list", None, cate, None
    if p.startswith("/order/basket.html"):
        return "cart", None, None, None
    if p.startswith("/order/orderform.html"):
        return "order", None, None, None
    if p.startswith("/order/order_result.html"):
        return "done", None, None, order
    if p.startswith("/member/"):
        return "member", None, None, None
    if p.startswith("/myshop/"):
        return "myshop", None, None, None
    if p.startswith("/nd/"):
        return "brand", None, None, None
    if p.startswith(("/board/", "/article/")):
        return "board", None, None, None
    return "other", None, None, None


def clean_url(u: str) -> str:
    """경로 + 허용 쿼리만 남긴다(검색어·회원 관련 값은 버림)."""
    path, _, query = (u or "").partition("?")
    path = path[:240]
    if not query:
        return path
    q = parse_qs(query)
    kept = [f"{k}={q[k][0][:60]}" for k in KEEP_QS if q.get(k)]
    return path + ("?" + "&".join(kept) if kept else "")


def kst_day(ts: datetime) -> str:
    return (ts + KST).strftime("%Y-%m-%d")


# ─────────────────────────────── 여정(깔때기) ───────────────────────────────

@dataclass
class Ev:
    sid: str
    vid: str
    ts: datetime
    kind: str
    page_type: str
    sn: int = 1
    device: str = "m"
    order_id: Optional[str] = None
    referrer: Optional[str] = None
    utm_source: Optional[str] = None


@dataclass
class Session:
    sid: str
    vid: str
    first_ts: datetime
    sn: int
    device: str
    entry: str
    source: str
    pages: list = field(default_factory=list)  # pv 페이지 유형 순서
    rank: int = 0
    orders: set = field(default_factory=set)


def source_of(referrer: Optional[str], utm: Optional[str], host: str = "nuldam.com") -> str:
    """유입 출처를 크게 묶는다."""
    if utm:
        u = utm.lower()
        if "meta" in u or "facebook" in u or "instagram" in u or u in ("fb", "ig"):
            return "메타 광고"
        if "naver" in u:
            return "네이버"
        if "kakao" in u:
            return "카카오"
        if "google" in u:
            return "구글"
        return "기타 캠페인"
    r = (referrer or "").lower()
    if not r or r.endswith("nuldam.com") or "cafe24" in r:
        return "직접·북마크"
    for k, lab in (("naver", "네이버"), ("instagram", "인스타그램"), ("facebook", "메타 광고"), ("kakao", "카카오"),
                   ("google", "구글"), ("daum", "다음"), ("youtube", "유튜브")):
        if k in r:
            return lab
    return "기타 사이트"


def build_sessions(events: Iterable[Ev]) -> list[Session]:
    by: dict[str, list[Ev]] = defaultdict(list)
    for e in events:
        by[e.sid].append(e)
    out = []
    for sid, evs in by.items():
        evs.sort(key=lambda e: e.ts)
        pvs = [e for e in evs if e.kind == "pv"]
        if not pvs:
            continue  # 페이지 줄 없이 클릭만 남은 방문(기간 경계)은 버린다
        f = pvs[0]
        s = Session(sid=sid, vid=f.vid, first_ts=f.ts, sn=f.sn or 1, device=f.device or "m",
                    entry=f.page_type, source=source_of(f.referrer, f.utm_source))
        for e in evs:
            if e.kind == "pv":
                if not s.pages or s.pages[-1] != e.page_type:
                    s.pages.append(e.page_type)
            s.rank = max(s.rank, _RANK.get(e.kind if e.kind != "pv" else e.page_type, 0))
            if e.order_id:
                s.orders.add(e.order_id)
        out.append(s)
    return out


def _stage_counts(sessions: list[Session]) -> list[int]:
    return [sum(1 for s in sessions if s.rank >= k) for k in range(len(STAGES))]


def _rate(a, b, d=2):
    return round(a / b * 100, d) if b else None


def funnel_report(sessions: list[Session], sankey_steps: int = 5, sankey_top: int = 7) -> dict:
    n = len(sessions)
    counts = _stage_counts(sessions)
    stages = []
    for i, (key, label) in enumerate(STAGES):
        prev = counts[i - 1] if i else counts[0]
        stages.append({
            "key": key, "label": label, "sessions": counts[i],
            "of_start": _rate(counts[i], counts[0]),
            "of_prev": _rate(counts[i], prev) if i else 100.0 if counts[0] else None,
            "drop": (prev - counts[i]) if i else 0,
        })

    # 단계별로 '여기까지 와서 다음으로 못 간' 방문이 마지막에 본 페이지
    drop_where = []
    for k in range(len(STAGES) - 1):
        stuck = [s for s in sessions if s.rank == k]
        last = Counter(s.pages[-1] for s in stuck if s.pages)
        drop_where.append({
            "stage": STAGES[k][1], "next": STAGES[k + 1][1], "sessions": len(stuck),
            "last_pages": [{"page_type": t, "label": PAGE_LABEL.get(t, t), "sessions": c, "share": _rate(c, len(stuck), 1)}
                           for t, c in last.most_common(6)],
        })

    def seg(name, subset):
        c = _stage_counts(subset)
        return {"name": name, "sessions": len(subset), "stages": c,
                "conv_rate": _rate(c[-1], len(subset)), "detail_rate": _rate(c[1], len(subset)),
                "order_to_done": _rate(c[4], c[3])}

    segments = {
        "visitor": [seg("첫 방문", [s for s in sessions if s.sn <= 1]),
                    seg("다시 온 방문자", [s for s in sessions if s.sn > 1])],
        "device": [seg("휴대폰", [s for s in sessions if s.device != "pc"]),
                   seg("PC", [s for s in sessions if s.device == "pc"])],
    }
    ent = Counter(s.entry for s in sessions)
    segments["entry"] = [dict(seg(PAGE_LABEL.get(t, t), [s for s in sessions if s.entry == t]), key=t)
                         for t, _ in ent.most_common(6)]
    src = Counter(s.source for s in sessions)
    segments["source"] = [seg(name, [s for s in sessions if s.source == name]) for name, _ in src.most_common(8)]

    # 날짜별 추이 (KST)
    daily = defaultdict(list)
    for s in sessions:
        daily[kst_day(s.first_ts)].append(s)
    trend = []
    for d in sorted(daily):
        c = _stage_counts(daily[d])
        trend.append({"date": d, "sessions": c[0], "detail": c[1], "intent": c[2], "order": c[3], "done": c[4],
                      "conv_rate": _rate(c[4], c[0])})

    return {
        "sessions": n,
        "visitors": len({s.vid for s in sessions}),
        "pageviews_per_session": round(sum(len(s.pages) for s in sessions) / n, 2) if n else None,
        "bounce_rate": _rate(sum(1 for s in sessions if len(s.pages) <= 1 and s.rank == 0), n),
        "stages": stages,
        "drop_where": drop_where,
        "segments": segments,
        "trend": trend,
        "sankey": sankey(sessions, sankey_steps, sankey_top),
    }


def sankey(sessions: list[Session], steps: int = 5, top: int = 7) -> dict:
    """처음 N걸음의 페이지 흐름. 노드 = (몇 번째 걸음, 페이지 유형), 끝난 방문은 '나감'으로 보낸다."""
    freq = Counter(t for s in sessions for t in s.pages[:steps])
    keep = {t for t, _ in freq.most_common(top)}
    keep |= {"done", "order"} & set(freq)  # 결제 경로는 적어도 늘 보이게

    def lab(t):
        return t if t in keep else "other"

    nodes: list[dict] = []
    idx: dict[tuple, int] = {}

    def node(step, t):
        key = (step, t)
        if key not in idx:
            idx[key] = len(nodes)
            name = "나감" if t == "_exit" else PAGE_LABEL.get(t, t)
            nodes.append({"name": name, "step": step, "type": t})
        return idx[key]

    links = Counter()
    for s in sessions:
        seq = [lab(t) for t in s.pages[:steps]]
        # 기타끼리 이어진 걸음은 한 칸으로 (기타→기타 고리 방지)
        merged = []
        for t in seq:
            if not merged or merged[-1] != t:
                merged.append(t)
        for i in range(len(merged) - 1):
            links[(node(i, merged[i]), node(i + 1, merged[i + 1]))] += 1
        if merged and len(s.pages) <= steps and merged[-1] != "done":
            last = len(merged) - 1
            links[(node(last, merged[-1]), node(last + 1, "_exit"))] += 1
    total = len(sessions) or 1
    out_links = [{"source": a, "target": b, "value": v} for (a, b), v in links.most_common()
                 if v >= max(1, total * 0.002)][:80]
    used = {l["source"] for l in out_links} | {l["target"] for l in out_links}
    # 쓰인 노드만 남기고 번호를 다시 매긴다
    remap = {old: new for new, old in enumerate(sorted(used))}
    return {
        "nodes": [dict(nodes[o], id=remap[o]) for o in sorted(used)],
        "links": [{"source": remap[l["source"]], "target": remap[l["target"]], "value": l["value"]} for l in out_links],
        "steps": steps,
    }


# ─────────────────────────────── 신규·재구매 ───────────────────────────────

def purchase_mix(rows: Iterable[tuple]) -> dict:
    """rows: (주문번호, 회원아이디|None, 재구매여부 bool|None). 회원 없음 = 비회원 주문."""
    new = rep = guest = 0
    for _oid, member, is_rep in rows:
        if not member:
            guest += 1
        elif is_rep:
            rep += 1
        else:
            new += 1
    total = new + rep + guest
    return {"total": total, "new": new, "repeat": rep, "guest": guest,
            "new_share": _rate(new, total, 1), "repeat_share": _rate(rep, total, 1), "guest_share": _rate(guest, total, 1),
            "repeat_share_members": _rate(rep, new + rep, 1)}


# ─────────────────────────────── 상세 스크롤 ───────────────────────────────
# 운영 상세는 [사진·가격] → [설명(약 840px로 접힘, 펼치기)] → [상품정보 고시] → [리뷰] → [문의] 순서.

DEPTHS = list(range(0, 101, 5))
SECTIONS = ["사진·가격", "상세 설명", "상품정보 고시", "리뷰", "문의"]


@dataclass
class View:
    product_no: int
    page_pct: int  # 페이지 전체 깊이 0~100
    section: int  # 도달 구역 0~4
    expanded: bool
    desc_pct: Optional[int]  # 펼친 설명 안 깊이 (안 펼쳤으면 None)
    dwell_ms: Optional[int]
    clicked: bool  # 이 페이지에서 담기·구매 버튼을 눌렀나


def curve(depths: list[int]) -> list[dict]:
    """깊이 p% 이상까지 내려 본 조회 비율."""
    n = len(depths)
    return [{"p": p, "share": _rate(sum(1 for d in depths if d >= p), n, 1)} for p in DEPTHS]


def biggest_drop(cv: list[dict], start_p: int = 5) -> Optional[dict]:
    """가장 많이 떠난 5% 구간 (첫 화면 0→5%는 다 보이므로 뺌)."""
    best = None
    for a, b in zip(cv, cv[1:]):
        if a["p"] < start_p or a["share"] is None or b["share"] is None:
            continue
        d = a["share"] - b["share"]
        if best is None or d > best["drop"]:
            best = {"from": a["p"], "to": b["p"], "drop": round(d, 1)}
    return best


def _med(xs):
    return median(xs) if xs else None


def scroll_report(views: list[View], names: dict[int, str], min_views: int = 30) -> dict:
    by = defaultdict(list)
    for v in views:
        by[v.product_no].append(v)

    def summarize(vs: list[View]) -> dict:
        n = len(vs)
        pp = [v.page_pct for v in vs]
        cv = curve(pp)
        ex = [v for v in vs if v.expanded]
        dd = [v.desc_pct for v in ex if v.desc_pct is not None]
        dw = [v.dwell_ms for v in vs if v.dwell_ms]
        clk = [v for v in vs if v.clicked]
        noclk = [v for v in vs if not v.clicked]
        # 구역 도달: k 구역 이상 본 조회 비율 (그 구역에서 멈춘 비율은 이웃 차이)
        sections = []
        for k, name in enumerate(SECTIONS):
            reach = sum(1 for v in vs if v.section >= k)
            stop = sum(1 for v in vs if v.section == k)
            sections.append({"k": k, "name": name, "reach": _rate(reach, n, 1), "stop": _rate(stop, n, 1)})
        return {
            "views": n,
            "median_page_pct": _med(pp),
            "curve": cv,
            "biggest_drop": biggest_drop(cv),
            "sections": sections,
            "expand_rate": _rate(len(ex), n, 1),
            "desc_views": len(dd),
            "desc_curve": curve(dd) if dd else None,
            "median_desc_pct": _med(dd),
            "median_dwell_s": round(median(dw) / 1000, 1) if dw else None,
            "click_rate": _rate(len(clk), n, 1),
            "median_page_pct_clicked": _med([v.page_pct for v in clk]),
            "median_page_pct_not_clicked": _med([v.page_pct for v in noclk]),
            "expand_rate_clicked": _rate(sum(1 for v in clk if v.expanded), len(clk), 1),
            "expand_rate_not_clicked": _rate(sum(1 for v in noclk if v.expanded), len(noclk), 1),
            "small_sample": n < min_views,
        }

    products = [dict(summarize(vs), product_no=no, name=names.get(no) or f"상품 {no}") for no, vs in by.items()]
    products.sort(key=lambda r: -r["views"])
    return {"overall": summarize(views) if views else None, "products": products, "min_views": min_views,
            "section_names": SECTIONS}
