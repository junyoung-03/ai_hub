import { Sparkles, FileText, CheckCircle2, Clock, Calendar, CheckSquare } from "lucide-react";

export function LandingAnalysisDemo() {
  return (
    <section id="demo" className="border-t border-line bg-surface px-4 py-16 sm:px-6 sm:py-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            STRUCTURED EXTRACTION
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            원문에서 실제 행동과 근거만 짚어냅니다
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            날짜가 적혀있다고 무조건 할 일로 만들지 않습니다. 행사 일시와 신청 마감일을 명확히 분리하고, 원문 인용(Evidence)을 항상 함께 제시합니다.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {/* Left: Original Source Document */}
          <div className="flex flex-col rounded-2xl border border-line bg-canvas p-6 lg:col-span-5">
            <div className="flex items-center justify-between border-b border-line pb-3.5">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-ink">수집된 원문 미리보기 (Source)</span>
              </div>
              <span className="rounded bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-ink">
                Gmail 안내문
              </span>
            </div>

            <div className="mt-4 flex-1 rounded-xl border border-line bg-surface p-5 font-mono text-xs leading-relaxed text-ink/90 sm:text-sm">
              <p className="font-sans font-bold text-ink">
                [공지] 2026 AI 세미나 참가 신청 안내
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground font-sans">
                발신: 산학협력단 인공지능연구센터 &lt;seminar@ai-hub.kr&gt;
              </p>
              <div className="my-3 border-t border-line/60" />
              <p className="font-sans text-xs text-muted-foreground">
                본 세미나는 AI 실무자 및 연구자를 대상으로 최신 에이전트 기술 동향을 공유합니다.
              </p>
              <div className="mt-3 space-y-1.5 rounded-lg bg-canvas p-3 border border-line/50 font-mono text-xs">
                <p>
                  <span className="rounded bg-amber-soft px-1 text-ink font-semibold">
                    - 신청 마감일: 2026-10-31
                  </span>
                </p>
                <p>- 필수 제출 서류: 참가신청서 1부</p>
                <p>- 참가비: 무료</p>
                <p>- 행사 일시: 2026-11-05 14:00</p>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground font-sans">
                * 기한 이후 제출된 서류는 접수되지 않으니 유의 바랍니다.
              </p>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              서버는 원본 텍스트를 그대로 보존하며 임의 변형하지 않습니다.
            </p>
          </div>

          {/* Right: AI Structured Analysis Result */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm lg:col-span-7">
            <div>
              <div className="flex items-center justify-between border-b border-line pb-3.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-amber" />
                  <span className="text-xs font-semibold text-ink">AI 구조화 분석 결과 (AI Analysis)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-soft px-2.5 py-0.5 text-xs font-semibold text-green">
                    분석 완료
                  </span>
                </div>
              </div>

              {/* Analysis Rows */}
              <div className="mt-5 space-y-4">
                {/* 1. Classification */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-xl border border-line bg-canvas p-3">
                    <span className="text-[11px] text-muted-foreground">문서 분류</span>
                    <p className="mt-0.5 text-xs font-semibold text-ink">공지·안내 / 세미나</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas p-3">
                    <span className="text-[11px] text-muted-foreground">주제 (Topic)</span>
                    <p className="mt-0.5 text-xs font-semibold text-ink">AI 세미나</p>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas p-3">
                    <span className="text-[11px] text-muted-foreground">태그 (Tags)</span>
                    <p className="mt-0.5 text-xs font-semibold text-ink">#인공지능 #참가신청</p>
                  </div>
                </div>

                {/* 2. Action Card */}
                <div className="rounded-xl border border-line bg-canvas p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <CheckSquare className="size-4 text-ink" />
                      해야 할 일 (Action)
                    </span>
                    <span className="rounded bg-rose-soft px-2 py-0.5 text-xs font-semibold text-rose">
                      required (필수 행동)
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-ink">
                    AI 세미나 참가 신청 (참가신청서 제출)
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Deadline (마감일) - Red/Rose accent */}
                    <div className="rounded-xl border border-rose/30 bg-surface p-3.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-semibold text-rose">
                          <Clock className="size-3.5" />
                          마감일 (Deadline)
                        </span>
                        <span className="rounded bg-rose px-1.5 py-0.5 text-[10px] font-bold text-white">
                          D-5
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-bold text-ink">2026.10.31 (금)</p>
                      <p className="text-[11px] text-muted-foreground">기한 내 미제출 시 접수 불가</p>
                    </div>

                    {/* Event Date (행사 일시) - Neutral/Calm accent */}
                    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs font-semibold text-ink">
                          <Calendar className="size-3.5" />
                          행사 일정 (Event Date)
                        </span>
                        <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                          일정
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-bold text-ink">2026.11.05 14:00</p>
                      <p className="text-[11px] text-muted-foreground">마감일과 분리된 행사 진행일</p>
                    </div>
                  </div>

                  {/* Requirements */}
                  <div className="rounded-lg bg-surface px-3 py-2 border border-line/70 text-xs">
                    <span className="font-semibold text-ink">제출 요건: </span>
                    <span className="text-muted-foreground">참가신청서 1부 · 참가비 무료</span>
                  </div>
                </div>

                {/* 3. Evidence */}
                <div className="rounded-xl border border-line bg-canvas p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <CheckCircle2 className="size-3.5 text-green" />
                    <span>추출 근거 (Evidence)</span>
                  </div>
                  <blockquote className="mt-2 rounded-lg border-l-2 border-amber bg-surface px-3 py-2 text-xs font-mono text-ink">
                    &ldquo;신청 마감일: 2026-10-31&rdquo;
                  </blockquote>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    원문 속 실제 구절의 위치(Offset)를 확인하여 허위 정보를 방지합니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-canvas p-3 text-xs text-muted-foreground">
              사용자가 분류나 태그를 수정하면 <span className="font-semibold text-ink">&ldquo;사용자 수정값(User Edited)&rdquo;</span>으로 보존되어 AI 재분석으로 덮어쓰지 않습니다.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
