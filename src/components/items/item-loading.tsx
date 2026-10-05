export function ItemLoading({ detail = false }: { detail?: boolean }) {
  return <main aria-busy="true" aria-label={detail ? "자료 상세 불러오는 중" : "정보 불러오는 중"} className="mx-auto max-w-5xl space-y-4 p-8"><p role="status">정보를 불러오는 중입니다.</p>{[0, 1, 2].map((key) => <div key={key} className="h-24 motion-safe:animate-pulse rounded-xl bg-muted" />)}</main>;
}
