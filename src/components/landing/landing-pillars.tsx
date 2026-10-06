import { Download, Search, CheckSquare2 } from "lucide-react";

export function LandingPillars() {
  return (
    <section id="pillars" className="px-4 py-16 sm:px-6 sm:py-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            CORE ARCHITECTURE
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            서비스의 3대 핵심 축
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            COLLECT로 정보를 안전하게 모으고, FIND로 똑똑하게 찾아내며, ACT로 행동을 완수합니다.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {/* Pillar 1: COLLECT */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-7 shadow-sm transition-all hover:border-ink/20">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Download className="size-5" />
                </span>
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-ink">
                  01
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-ink">COLLECT</h3>
                <p className="mt-1 text-sm font-medium text-ink/80">
                  흩어진 정보를 한곳으로 모읍니다.
                </p>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                채널마다 분산된 일상 및 업무 데이터를 단일 Unified ITEM 구조로 표준화하여 관리합니다.
              </p>

              <ul className="space-y-2 border-t border-line/60 pt-4 text-xs font-medium text-ink">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  Gmail 메일함 자동 수집
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  Google Drive Docs 문서 수집
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  Google Calendar 일정 연동
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  PDF 직접 업로드 및 텍스트 추출
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  이미지 / 스크린샷 온디바이스 OCR
                </li>
              </ul>
            </div>

            <div className="mt-6 rounded-xl bg-canvas p-3 text-[11px] text-muted-foreground">
              Google 원본은 Google에 유지하고, 서비스 데이터 삭제가 원본 삭제로 이어지지 않습니다.
            </div>
          </div>

          {/* Pillar 2: FIND */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-7 shadow-sm transition-all hover:border-ink/20">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Search className="size-5" />
                </span>
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-ink">
                  02
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-ink">FIND</h3>
                <p className="mt-1 text-sm font-medium text-ink/80">
                  AI가 내용을 읽고 구조화합니다.
                </p>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                단순 키워드 검색을 넘어 맥락과 의미를 파악하며 원문 위치(Evidence)를 직접 증명합니다.
              </p>

              <ul className="space-y-2 border-t border-line/60 pt-4 text-xs font-medium text-ink">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  9대 문서 유형 자동 분류
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  자연어 통합 검색 (Keyword + Vector)
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  원문 위치·인용구 기반 Evidence 제공
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  유사한 관련 자료 추천 (Similar)
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  사용자 직접 분류 수정 우선 보호
                </li>
              </ul>
            </div>

            <div className="mt-6 rounded-xl bg-canvas p-3 text-[11px] text-muted-foreground">
              관련 근거가 없는 경우 인공지능이 임의로 추측하거나 환각을 일으키지 않습니다.
            </div>
          </div>

          {/* Pillar 3: ACT */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-7 shadow-sm transition-all hover:border-ink/20">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <CheckSquare2 className="size-5" />
                </span>
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-ink">
                  03
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-ink">ACT</h3>
                <p className="mt-1 text-sm font-medium text-ink/80">
                  해야 할 일을 놓치지 않습니다.
                </p>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                날짜만 있다고 할 일을 만들지 않고, 실제 행동 요구와 확정 마감일만 D-Day로 관리합니다.
              </p>

              <ul className="space-y-2 border-t border-line/60 pt-4 text-xs font-medium text-ink">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  실제 행동(Action) 및 의무 구분
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  명확한 마감일(Deadline) 추출
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  D-Day 실시간 마감 레일 표시
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  행사 일정과 제출 마감일 엄격 분리
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-ink" />
                  할 일 완료 및 복원 상태 관리
                </li>
              </ul>
            </div>

            <div className="mt-6 rounded-xl bg-canvas p-3 text-[11px] text-muted-foreground">
              동일 안내가 여러 출처에서 발견되면 Action을 중복 생성하지 않고 출처를 병합합니다.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
