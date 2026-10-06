import { Mail, Folder, CalendarDays, RefreshCw, CheckCircle2 } from "lucide-react";

export function LandingSyncPreview() {
  return (
    <section className="border-t border-line bg-surface px-4 py-16 sm:px-6 sm:py-24 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            UPCOMING CAPABILITY
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            원클릭 통합 동기화
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Gmail, Drive, Calendar의 새로운 업데이트를 한 번에 점검하고 D-Day와 마감일을 최신으로 유지합니다.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-line bg-canvas p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <span className="text-xs font-semibold text-muted-foreground">DEMO PREVIEW</span>
              <h3 className="text-base font-bold text-ink">Google 계정 연결 및 동기화 상태</h3>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-xs font-semibold text-green">
              <CheckCircle2 className="size-3.5" />
              연결됨
            </span>
          </div>

          <div className="mt-4 divide-y divide-line/60 rounded-xl border border-line bg-surface">
            {/* Row 1: Gmail */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-canvas text-ink border border-line/60">
                  <Mail className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink sm:text-sm">Gmail (받은편지함)</p>
                  <p className="text-[11px] text-muted-foreground">최근 30일 공지 및 요청 메일</p>
                </div>
              </div>
              <span className="text-xs font-medium text-green">정상 · 방금 전</span>
            </div>

            {/* Row 2: Drive */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-canvas text-ink border border-line/60">
                  <Folder className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink sm:text-sm">Google Drive (Docs)</p>
                  <p className="text-[11px] text-muted-foreground">지정 폴더 및 문서 서식</p>
                </div>
              </div>
              <span className="text-xs font-medium text-green">정상 · 8분 전</span>
            </div>

            {/* Row 3: Calendar */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-canvas text-ink border border-line/60">
                  <CalendarDays className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink sm:text-sm">Google Calendar</p>
                  <p className="text-[11px] text-muted-foreground">기본 캘린더 등록 일정 (-30일 ~ +90일)</p>
                </div>
              </div>
              <span className="text-xs font-medium text-green">정상 · 12분 전</span>
            </div>
          </div>

          {/* Sync Button Mock */}
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              * 랜딩 화면 데모이며 실제 수집 요청은 발생하지 않습니다.
            </p>
            <button
              type="button"
              disabled
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-xs font-medium text-ink/70 opacity-80 cursor-default"
            >
              <RefreshCw className="size-3.5" />
              <span>전체 동기화 (데모)</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
