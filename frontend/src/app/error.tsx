'use client';

// 렌더 중 예외가 나도 백스크린("Application error") 대신 이 화면을 보여준다.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-bg-level-0, #0b0d14)' }}>
      <div className="w-full max-w-sm text-center">
        <img src="/icons3d/empty.png" alt="" width={96} height={96} className="nd-icon3d mx-auto mb-4" />
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary, #eef0f5)' }}>
          화면을 불러오지 못했습니다
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-text-tertiary, #a3a9b8)' }}>
          잠시 뒤 다시 시도해 주세요. 계속되면 새로고침합니다.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--nd-accent, #0659ff)', color: 'var(--nd-on-accent, #fff)' }}
          >
            다시 시도
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--color-text-secondary, #a3a9b8)', border: '1px solid var(--color-border-secondary, rgba(238,240,245,.16))' }}
          >
            새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
