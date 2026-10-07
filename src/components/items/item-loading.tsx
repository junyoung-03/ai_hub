export function ItemLoading({ detail = false }: { detail?: boolean }) {
  return (
    <div aria-busy="true" aria-label={detail ? "자료 상세 불러오는 중" : "정보 불러오는 중"} className="space-y-4 pt-1">
      <span className="sr-only">불러오는 중...</span>
      {detail ? (
        <div className="space-y-4">
          <div className="h-8 w-48 motion-safe:animate-pulse rounded-lg bg-line/60" />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-72 motion-safe:animate-pulse rounded-xl border border-line bg-surface/50" />
            <div className="h-72 motion-safe:animate-pulse rounded-xl border border-line bg-surface/50" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-10 w-44 motion-safe:animate-pulse rounded-lg bg-line/60" />
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 motion-safe:animate-pulse rounded-xl border border-line bg-surface/50" />
          ))}
        </div>
      )}
    </div>
  );
}
