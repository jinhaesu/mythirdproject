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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-bg-0, #0a0a0a)' }}>
      <div className="w-full max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'rgba(229,72,77,0.12)' }}
        >
          <span style={{ fontSize: 26 }}>⚠️</span>
        </div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary, #e4e4e7)' }}>
          일시적인 오류가 발생했습니다
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-text-tertiary, #a1a1aa)' }}>
          화면을 불러오는 중 문제가 발생했습니다. 다시 시도해 주세요.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-brand-bg, #5e6ad2)' }}
          >
            다시 시도
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--color-text-secondary, #d4d4d8)', border: '1px solid var(--color-border-primary, #3f3f46)' }}
          >
            새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
