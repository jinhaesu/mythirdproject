"""베스트 순위 집계 단위 테스트 (카페24·DB 호출 없음).

실행: cd backend && python -m unittest tests.test_best_ranking -v
"""
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("best_ranking", os.path.join(HERE, "..", "app", "services", "best_ranking.py"))
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)


class TallyTest(unittest.TestCase):
    def test_status_and_mapping(self):
        pmap = {91: 91, 4000: 564, 564: 564}
        orders = [
            {"paid": "T", "canceled": "F", "order_date": "2026-10-28T10:00:00+09:00", "items": [
                {"product_no": 91, "quantity": 2, "order_status": "N40"},
                {"product_no": 4000, "quantity": 3, "order_status": "N10"},   # 공구 → 564에 합산
                {"product_no": 91, "quantity": 5, "order_status": "C40"},     # 취소 제외
                {"product_no": 91, "quantity": 5, "order_status": "R40"},     # 반품 제외
                {"product_no": 999, "quantity": 9, "order_status": "N40"},    # 매핑 없음 제외
            ]},
            {"paid": "F", "canceled": "F", "order_date": "2026-10-28", "items": [
                {"product_no": 91, "quantity": 7, "order_status": "N00"}]},  # 입금 전 제외
            {"paid": "T", "canceled": "T", "order_date": "2026-10-27", "items": [
                {"product_no": 564, "quantity": 7, "order_status": "N40"}]},  # 취소 주문 제외
        ]
        qty, days = br.tally(orders, pmap)
        self.assertEqual(dict(qty), {91: 2, 564: 3})
        self.assertEqual(days, {"2026-10-28"})

    def test_result_has_no_quantity(self):
        from collections import Counter
        r = br._result("sales_7d", None, None, Counter({91: 5, 564: 9}))
        self.assertEqual([i["product_no"] for i in r["items"]], [564, 91])
        self.assertTrue(all(set(i) == {"rank", "product_no"} for i in r["items"]))

    def test_map_file_loads_and_hides_link_only(self):
        m = br.product_map()
        self.assertEqual(m[4000], 564)  # [28기 현숙X널담] 바게트 → 대표 진열 바게트
        reps = set(m.values())
        self.assertTrue(reps.isdisjoint({4000, 3999, 144}))


if __name__ == "__main__":
    unittest.main()
