import { NextRequest, NextResponse } from 'next/server';

const SMARTSTORE_REVIEW_URL = 'https://smartstore.naver.com/i/v1/reviews/paged-reviews';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const originProductNo = searchParams.get('originProductNo');
  const merchantNo = searchParams.get('merchantNo');
  const page = searchParams.get('page') || '1';
  const pageSize = searchParams.get('pageSize') || '20';

  if (!originProductNo) {
    return NextResponse.json({ error: 'originProductNo required' }, { status: 400 });
  }

  const params = new URLSearchParams({
    originProductNo,
    page,
    pageSize,
    sortType: 'REVIEW_CREATE_DATE_DESC',
  });
  if (merchantNo) params.set('merchantNo', merchantNo);

  try {
    const resp = await fetch(`${SMARTSTORE_REVIEW_URL}?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `SmartStore API ${resp.status}`, status: resp.status },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
