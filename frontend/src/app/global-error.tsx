'use client';

// 루트 레이아웃에서 예외가 나면 error.tsx가 못 잡는다. 최후 방어선 — 자체 html/body.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0a0a0a', color: '#e4e4e7' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 360, textAlign: 'center' }}>
            <div style={{ margin: '0 auto 16px', width: 56, height: 56, borderRadius: '9999px', background: 'rgba(229,72,77,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>⚠️</div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>일시적인 오류가 발생했습니다</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#a1a1aa' }}>화면을 불러오는 중 문제가 발생했습니다. 새로고침해 주세요.</p>
            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => reset()} style={{ background: '#5e6ad2', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>다시 시도</button>
              <button onClick={() => window.location.reload()} style={{ background: 'transparent', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>새로고침</button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
