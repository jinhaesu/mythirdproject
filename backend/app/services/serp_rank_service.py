"""네이버 통합검색(SERP) 쇼핑 블록 크롤러.

쇼핑 검색 오픈API(shop.json) 서비스 종료(404 SE05) 대체 수단.
search.naver.com 통합검색 HTML은 서버 IP에서도 차단 없이 열리며(실측),
쇼핑 블록 상품 카드는 cr*.shopping.naver.com/v2/bridge/searchGate?nv_mid=
앵커 패턴으로 파싱한다 — CSS 클래스는 난독화·회전되므로 URL 패턴만 의존.

순위 의미: "통합검색 쇼핑 블록 내 노출 순서" (상위 ~5-20개 카드).
쇼핑 버티컬 전체 100위가 아니라 사용자가 검색 시 실제로 보는 노출 순위다.
"""
import html as _html
import logging
import re
from typing import Any, Dict, List

import httpx

logger = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
_HEADERS = {"User-Agent": _UA, "Accept-Language": "ko-KR,ko;q=0.9"}

_ANCHOR = re.compile(
    r'href="(https://cr\d?\.shopping\.naver\.com/v2/bridge/searchGate\?nv_mid=(\d+)[^"]*)"'
    r'[^>]*>(.{0,600}?)</a>',
    re.S,
)
_TITLE_IN = re.compile(r'alt="([^"]{3,120})"|<span[^>]*>([^<]{3,120})</span>')
_IMG_IN = re.compile(r'src="(https://shopping-phinf\.pstatic\.net/[^"]+)"')
# 카드 뒤따르는 영역의 "판매가 12,340원" 패턴
_PRICE_AFTER = re.compile(r'>([\d,]{2,10})</span><span[^>]*>원<')
_STRIP_TAGS = re.compile(r"</?mark>|<[^>]+>")
_NOISE_TITLES = {"네이버페이", "찜하기", "링크이미지", "favicon", "광고"}


def _clean(text: str) -> str:
    return _STRIP_TAGS.sub("", _html.unescape(text)).strip()


def parse_serp_shopping(html_text: str) -> List[Dict[str, Any]]:
    """SERP HTML에서 쇼핑 블록 상품 카드를 문서 순서대로 추출한다."""
    seen: set = set()
    items: List[Dict[str, Any]] = []
    matches = list(_ANCHOR.finditer(html_text))
    for i, m in enumerate(matches):
        link, nv_mid, inner = m.group(1), m.group(2), m.group(3)
        tm = _TITLE_IN.search(inner)
        title = _clean((tm.group(1) or tm.group(2)) if tm else "")
        if not title or title in _NOISE_TITLES:
            continue
        if nv_mid in seen:
            continue
        seen.add(nv_mid)

        im = _IMG_IN.search(inner)
        # 가격은 카드 뒤쪽 인접 영역에서 탐색. 같은 상품이 이미지/제목 앵커로
        # 두 번 나오므로 "다음 다른 상품(nv_mid)의 앵커" 직전까지를 카드 범위로 본다.
        tail_end = min(len(html_text), m.end() + 2500)
        for nxt in matches[i + 1:]:
            if nxt.group(2) != nv_mid:
                tail_end = min(tail_end, nxt.start())
                break
        pm = _PRICE_AFTER.search(html_text, m.end(), tail_end)

        items.append({
            "nv_mid": nv_mid,
            "title": title,
            "link": _html.unescape(link),
            "image": im.group(1) if im else "",
            "price": pm.group(1).replace(",", "") if pm else "",
        })
    return items


async def fetch_serp_shopping(
    client: httpx.AsyncClient,
    keyword: str,
    brand_name: str,
) -> Dict[str, Any]:
    """키워드 통합검색 → 쇼핑 블록 상품 목록 + 브랜드 순위/필터칩 노출 여부."""
    result: Dict[str, Any] = {
        "ok": False,
        "items": [],
        "brand_ranks": [],
        "brand_chip": False,
        "error": None,
    }
    try:
        resp = await client.get(
            "https://search.naver.com/search.naver",
            params={"query": keyword},
            headers=_HEADERS,
        )
    except Exception as e:
        result["error"] = str(e)
        logger.warning(f"[SerpRank] fetch failed for '{keyword}': {e}")
        return result

    if resp.status_code != 200:
        result["error"] = f"HTTP {resp.status_code}"
        logger.warning(f"[SerpRank] HTTP {resp.status_code} for '{keyword}'")
        return result

    html_text = resp.text
    items = parse_serp_shopping(html_text)
    result["ok"] = True
    result["items"] = items
    # 쇼핑 블록 브랜드 필터 칩에 브랜드가 노출되는지 (상위 인지도 시그널)
    result["brand_chip"] = f">{brand_name}</button>" in html_text
    result["brand_ranks"] = [
        {"rank": idx, "title": it["title"], "price": it["price"], "link": it["link"]}
        for idx, it in enumerate(items, 1)
        if brand_name in it["title"]
    ]
    if not items:
        logger.info(f"[SerpRank] 0 shopping cards for '{keyword}' (비상거래성 키워드 또는 구조 변경)")
    return result
