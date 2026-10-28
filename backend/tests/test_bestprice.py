"""회원 최저가 쿠폰 + 쿠폰 요청 본문 단위 테스트 (카페24·DB 호출 없음).

실행: cd backend && python -m unittest tests.test_bestprice -v
순수 모듈은 패키지 __init__(외부 SDK import)를 피하려고 파일 경로로 직접 읽는다.
"""
import asyncio
import importlib.util
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICES = os.path.join(HERE, "..", "app", "services")


def _load(name):
    spec = importlib.util.spec_from_file_location(f"_t_{name}", os.path.join(SERVICES, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


spec = _load("cafe24_coupon_spec")
L = _load("bestprice_logic")


class CouponSpecTest(unittest.TestCase):
    def test_affiliate_benefit_mapping_matches_docs(self):
        # 문서 2026-09-01: A=정액, B=정률, E=기본배송비 전액
        self.assertEqual(spec.affiliate_benefit_type("fixed"), "A")
        self.assertEqual(spec.affiliate_benefit_type("percentage"), "B")
        self.assertEqual(spec.affiliate_benefit_type("shipping"), "E")
        self.assertEqual(spec.affiliate_benefit_type(None), "B")

    def test_apply_benefit_puts_right_field(self):
        b = spec.apply_benefit({}, "A", 10, 3000)
        self.assertEqual(b, {"benefit_type": "A", "discount_amount": {"benefit_price": 3000}})
        b = spec.apply_benefit({}, "B", 10, 3000)
        self.assertEqual(b, {"benefit_type": "B", "discount_rate": {"benefit_percentage": 10}})

    def test_scope_values(self):
        self.assertEqual(spec.apply_scope({}), {"available_product": "U", "available_category": "U"})
        b = spec.apply_scope({}, product_nos=[12, 12, 7])
        self.assertEqual((b["available_product"], b["available_product_list"], b["available_category"]), ("I", [7, 12], "U"))
        b = spec.apply_scope({}, category_no=671, product_nos=[1])
        self.assertEqual((b["available_category"], b["available_category_list"], b["available_product"]), ("I", [671], "U"))

    def test_bestprice_coupon_request(self):
        r = spec.build_bestprice_coupon_request(amount=1500, month="2026-11", issue_max_count=20000)["request"]
        self.assertEqual(r["coupon_name"], "널담 회원 최저가 1,500원 (11월)")
        self.assertTrue(r["coupon_name"].startswith(spec.BESTPRICE_NAME_PREFIX))
        self.assertEqual(r["discount_amount"], {"benefit_price": 1500})
        expect = {"benefit_type": "A", "issue_type": "M", "available_scope": "O",
                  "available_period_type": "R", "available_day_from_issued": 14, "available_min_price": 15000,
                  "available_price_type": "O", "available_coupon_count_by_order": 1, "issue_limit": "F",
                  "send_sms_for_issue": "F", "send_email_for_issue": "F",
                  "use_notification_when_login": "F", "show_product_detail": "F"}
        for k, v in expect.items():
            self.assertEqual(r[k], v, k)
        self.assertNotIn("issue_max_count", r)  # 카페24 999 제한 → 보내지 않음
        with self.assertRaises(ValueError):
            spec.build_bestprice_coupon_request(amount=0, month="2026-11", issue_max_count=1)

    def test_issue_request(self):
        r = spec.build_issue_request(["a"])["request"]
        self.assertEqual(r, {"issued_member_scope": "M", "member_id": "a", "send_sms_for_issue": "F",
                             "allow_duplication": "F", "single_issue_per_once": "T"})
        self.assertEqual(spec.build_issue_request(["a", "b"])["request"]["member_id"], ["a", "b"])


class LogicTest(unittest.TestCase):
    def test_classify(self):
        c = L.classify
        self.assertEqual(c(days_since_join=3, n_orders=0, days_since_last=None, amount_365=0), "new")
        self.assertEqual(c(days_since_join=100, n_orders=0, days_since_last=None, amount_365=0), "nopurchase")
        self.assertEqual(c(days_since_join=900, n_orders=0, days_since_last=None, amount_365=0), "longinactive")
        self.assertEqual(c(days_since_join=None, n_orders=0, days_since_last=None, amount_365=0), "longinactive")
        self.assertEqual(c(days_since_join=900, n_orders=9, days_since_last=200, amount_365=400000), "vip")
        self.assertEqual(c(days_since_join=900, n_orders=1, days_since_last=121, amount_365=0), "lapsed")
        self.assertEqual(c(days_since_join=900, n_orders=1, days_since_last=61, amount_365=0), "dormant")
        self.assertEqual(c(days_since_join=900, n_orders=3, days_since_last=5, amount_365=0), "loyal")
        self.assertEqual(c(days_since_join=900, n_orders=2, days_since_last=60, amount_365=0), "active")

    def test_every_tier_has_positive_amount(self):
        # 대표 결정: 0원 구간·제외 구간 없음
        self.assertEqual(L.TIER_AMOUNT, {"new": 1000, "vip": 500, "loyal": 300, "active": 500,
                                         "dormant": 1500, "lapsed": 1500, "nopurchase": 1000, "longinactive": 1000})

    def test_rates_fallback_on_small_sample(self):
        r = L.blended_rates({"dormant": (1000, 30), "vip": (10, 9)})
        self.assertAlmostEqual(r["dormant"], 0.03)
        self.assertEqual(r["vip"], L.DEFAULT_BUYER_RATE["vip"])

    def test_plan_respects_cap_priority_and_batch(self):
        rates = {t: 0.1 for t in L.TIER_ORDER}  # 기대비용 = 0.1×1.3×금액
        cands = {"new": ["n1", "n2"], "dormant": ["d1", "d2", "d3"], "longinactive": ["l1"]}
        # new 1명 130, dormant 1명 195 → 상한 600: n1,n2(260) + d1(195)=455, d2면 650 초과 → 보류
        p = L.plan_issuance(cands, rates=rates, safety=1.3, cap=600, committed_expected=0, max_issue=100)
        # l1(130)은 455+130=585 ≤ 600 이라 발급
        self.assertEqual([m for m, _ in p.issue], ["n1", "n2", "d1", "l1"])
        self.assertLessEqual(p.planned_expected, 600)
        self.assertEqual(p.per_tier["dormant"]["deferred_budget"], 2)
        # 이미 기발급 기대비용이 있으면 그만큼 빠짐
        p2 = L.plan_issuance(cands, rates=rates, safety=1.3, cap=600, committed_expected=500, max_issue=100)
        self.assertEqual([m for m, _ in p2.issue], [])
        # 밤당 상한
        p3 = L.plan_issuance(cands, rates=rates, safety=1.3, cap=10 ** 9, committed_expected=0, max_issue=2)
        self.assertEqual(len(p3.issue), 2)
        self.assertEqual(p3.deferred_batch, 4)
        self.assertEqual(p3.per_tier["new"]["worst_case_cost"], 2000)

    def test_cap_status(self):
        self.assertEqual(L.cap_status(0, 3_000_000, 0.7), "ok")
        self.assertEqual(L.cap_status(2_100_000, 3_000_000, 0.7), "warn")
        self.assertEqual(L.cap_status(3_000_000, 3_000_000, 0.7), "reached")


class WriteGuardTest(unittest.TestCase):
    def test_promo_write_blocked_when_not_live(self):
        sys.path.insert(0, os.path.join(HERE, ".."))
        try:
            os.environ["BESTPRICE_LIVE"] = "false"
            from app.services import cafe24_promo
        except Exception as e:  # 의존성 없는 환경
            self.skipTest(f"app import 불가: {e}")
        with self.assertRaises(cafe24_promo.BestpriceWriteBlocked):
            asyncio.run(cafe24_promo.promo_request(None, "POST", "/api/v2/admin/coupons", json={}))


if __name__ == "__main__":
    unittest.main()
