"""자사몰 여정·스크롤 집계 — 가짜 기록으로만 시험(네트워크·DB 없음)."""
from datetime import datetime, timedelta

from app.services import journey as jn


def test_classify_paths():
    assert jn.classify("/") == ("main", None, None, None)
    assert jn.classify("/product/detail.html?product_no=1630&cate_no=47") == ("detail", 1630, 47, None)
    assert jn.classify("/product/%EC%A0%80%EB%8B%B9-%EB%91%90%EB%B0%94%EC%9D%B4/1630/category/47/display/1/")[:2] == ("detail", 1630)
    assert jn.classify("/surl/P/25")[:2] == ("detail", 25)
    assert jn.classify("/category/베이커리/169/")[0] == "list" and jn.classify("/category/베이커리/169/")[2] == 169
    assert jn.classify("/product/list.html?cate_no=47")[0] == "list"
    assert jn.classify("/order/basket.html")[0] == "cart"
    assert jn.classify("/order/orderform.html?basket_type=A0000")[0] == "order"
    assert jn.classify("/order/order_result.html?order_id=20261104-0001234") == ("done", None, None, "20261104-0001234")
    assert jn.classify("/order/order_result.html?order_id=bad")[3] is None
    assert jn.classify("/skin-skin13/product/detail.html?product_no=3")[:2] == ("detail", 3)
    assert jn.classify("/nd/lineup.html")[0] == "brand"
    assert jn.classify("/exec/front/x")[0] == "other"


def test_clean_url_drops_unknown_query():
    assert jn.clean_url("/product/search.html?keyword=비밀&product_no=3") == "/product/search.html?product_no=3"
    assert jn.clean_url("/order/basket.html") == "/order/basket.html"


def test_ids_and_bots():
    assert jn.is_id("0123456789abcdef01234567")
    assert not jn.is_id("xyz") and not jn.is_id(None)
    assert jn.is_bot("Mozilla/5.0 (compatible; Googlebot/2.1)")
    assert not jn.is_bot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")


T0 = datetime(2026, 11, 4, 1, 0, 0)


def _ev(sid, i, kind, pt, sn=1, order=None, ref=None, dev="m", vid=None):
    return jn.Ev(sid=sid, vid=vid or "v" + sid, ts=T0 + timedelta(minutes=i), kind=kind, page_type=pt, sn=sn,
                 device=dev, order_id=order, referrer=ref)


def _sessions():
    evs = [
        # A: 메인 → 상세 → 구매 버튼 → 주문서 → 완료 (첫 방문, 네이버)
        _ev("A", 0, "pv", "main", ref="m.search.naver.com"), _ev("A", 1, "pv", "detail"),
        _ev("A", 2, "buy_click", "detail"), _ev("A", 3, "pv", "order"), _ev("A", 4, "pv", "done", order="20261104-0000001"),
        # B: 메인만 보고 나감 (다시 온 방문자)
        _ev("B", 0, "pv", "main", sn=3),
        # C: 상세로 들어와 장바구니까지 (PC)
        _ev("C", 0, "pv", "detail", dev="pc"), _ev("C", 1, "pv", "cart", dev="pc"),
        # D: 목록 → 상세 → 상세(같은 유형 연속은 한 칸) → 나감
        _ev("D", 0, "pv", "list"), _ev("D", 1, "pv", "detail"), _ev("D", 2, "pv", "detail"),
        # 페이지 줄 없는 클릭만 있는 방문은 버림
        _ev("E", 0, "cart_click", "detail"),
    ]
    return jn.build_sessions(evs)


def test_build_sessions_and_funnel():
    ss = _sessions()
    assert {s.sid for s in ss} == {"A", "B", "C", "D"}
    d = {s.sid: s for s in ss}
    assert d["A"].rank == 4 and d["A"].orders == {"20261104-0000001"} and d["A"].source == "네이버"
    assert d["B"].rank == 0 and d["C"].rank == 2 and d["D"].rank == 1
    assert d["D"].pages == ["list", "detail"]
    rep = jn.funnel_report(ss)
    assert [st["sessions"] for st in rep["stages"]] == [4, 3, 2, 1, 1]
    assert rep["stages"][4]["of_start"] == 25.0
    assert rep["stages"][1]["drop"] == 1
    assert rep["bounce_rate"] == 25.0
    vis = {x["name"]: x for x in rep["segments"]["visitor"]}
    assert vis["첫 방문"]["sessions"] == 3 and vis["다시 온 방문자"]["conv_rate"] == 0.0
    # 상세까지 와서 다음으로 못 간 방문(D)의 마지막 페이지 = 상세
    stuck = rep["drop_where"][1]
    assert stuck["sessions"] == 1 and stuck["last_pages"][0]["page_type"] == "detail"


def test_sankey_is_dag_and_has_exit():
    sk = jn.sankey(_sessions())
    ids = {n["id"] for n in sk["nodes"]}
    step = {n["id"]: n["step"] for n in sk["nodes"]}
    assert sk["links"]
    for l in sk["links"]:
        assert l["source"] in ids and l["target"] in ids
        assert step[l["target"]] == step[l["source"]] + 1  # 한 걸음씩만 앞으로 → 고리 없음
    assert any(n["name"] == "나감" for n in sk["nodes"])


def test_purchase_mix():
    m = jn.purchase_mix([("1", "a", False), ("2", "b", True), ("3", None, None), ("4", "c", True)])
    assert (m["new"], m["repeat"], m["guest"], m["total"]) == (1, 2, 1, 4)
    assert m["repeat_share_members"] == 66.7


def test_scroll_report():
    # (페이지 깊이, 구역, 펼침, 설명 깊이, 클릭)
    raw = [(10, 0, False, None, False), (20, 1, False, None, False), (30, 1, False, None, False), (50, 2, False, None, False),
           (60, 2, True, 40, False), (80, 3, True, 100, True), (100, 4, True, 100, True), (100, 4, False, None, True)]
    views = [jn.View(1, pp, sec, ex, dp, 30000, ck) for pp, sec, ex, dp, ck in raw] + [jn.View(2, 50, 2, False, None, None, False)]
    rep = jn.scroll_report(views, {1: "베이글"}, min_views=5)
    p1 = rep["products"][0]
    assert p1["product_no"] == 1 and p1["name"] == "베이글" and p1["views"] == 8
    cv = {c["p"]: c["share"] for c in p1["curve"]}
    assert cv[0] == 100.0 and cv[50] == 62.5 and cv[100] == 25.0
    sec = {s["k"]: s for s in p1["sections"]}
    assert sec[0]["reach"] == 100.0 and sec[1]["reach"] == 87.5 and sec[3]["reach"] == 37.5 and sec[0]["stop"] == 12.5
    assert p1["expand_rate"] == 37.5 and p1["desc_views"] == 3 and p1["median_desc_pct"] == 100
    assert p1["click_rate"] == 37.5 and p1["median_page_pct_clicked"] == 100
    assert p1["expand_rate_clicked"] == 66.7 and p1["biggest_drop"]["drop"] > 0
    assert rep["products"][1]["name"] == "상품 2" and rep["products"][1]["small_sample"]
    assert rep["overall"]["views"] == 9
