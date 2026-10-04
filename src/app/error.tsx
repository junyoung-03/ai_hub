"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div role="alert" className="max-w-sm space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1>
        <p className="text-sm text-muted-foreground">연결 상태를 확인한 후 다시 시도해 주세요.</p>
        <button type="button" onClick={reset} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">다시 시도</button>
      </div>
    </main>
  );
}
