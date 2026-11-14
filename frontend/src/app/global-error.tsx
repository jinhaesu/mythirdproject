'use client';

// 루트 레이아웃에서 예외가 나면 error.tsx가 못 잡는다. 최후 방어선 — 자체 html/body.
// 전역 CSS 가 없을 수 있어 색은 고정값(널담 기준 2 어두운 화면 값)으로 둔다.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b0d14', color: '#eef0f5' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 360, textAlign: 'center' }}>
            <img src="/icons3d/empty.png" alt="" width={96} height={96} style={{ display: 'block', margin: '0 auto 16px' }} />
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>화면을 불러오지 못했습니다</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#a3a9b8' }}>잠시 뒤 다시 시도해 주세요. 계속되면 새로고침합니다.</p>
            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => reset()} style={{ background: '#0659ff', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>다시 시도</button>
              <button onClick={() => window.location.reload()} style={{ background: 'transparent', color: '#eef0f5', border: '1px solid rgba(238,240,245,.16)', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>새로고침</button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
