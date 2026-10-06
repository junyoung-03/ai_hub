import { Mail, Folder, CalendarDays, CheckCircle2, Clock, Calendar, Sparkles, FileText } from "lucide-react";
import { LandingAuthButton } from "./landing-auth-button";

type LandingHeroProps = {
  isLoggedIn: boolean;
};

export function LandingHero({ isLoggedIn }: LandingHeroProps) {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Hero Left Column */}
          <div className="space-y-6 lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <span className="size-1.5 rounded-full bg-green" />
              <span>COLLECT · FIND · ACT</span>
              <span className="text-line">|</span>
              <span className="text-ink font-semibold">개인 AI 정보 허브</span>
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl md:text-5xl md:leading-[1.18]">
              흩어진 메일·문서·일정을<br />
              <span className="text-ink">AI가 한곳에서 정리합니다.</span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Gmail, Google Drive, Calendar와 업로드한 문서를 모아
              해야 할 일, 마감일, 일정과 그 근거를 자동으로 찾아드립니다.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <LandingAuthButton isLoggedIn={isLoggedIn} variant="hero" />
              <a
                href="#pillars"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:bg-canvas sm:text-base"
              >
                어떻게 동작하나요 ↓
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-green" />
                Google 서비스 로그인만 사용
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-green" />
                원본 데이터 안전 보존
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-green" />
                문서별 증거(Evidence) 제공
              </span>
            </div>
          </div>

          {/* Hero Right Column: Synthetic Demo Component */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]">
              {/* Demo Top Bar: Google Connection Status */}
              <div className="mb-4 flex items-center justify-between border-b border-line pb-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-green" />
                  <span className="text-xs font-semibold text-ink">Google 연결 상태</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mail className="size-3 text-green" />
                    <span>Gmail 정상</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Folder className="size-3 text-green" />
                    <span>Drive 정상</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3 text-green" />
                    <span>Calendar 정상</span>
                  </span>
                </div>
              </div>

              {/* Synthetic ITEM Card */}
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-ink">
                        Gmail
                      </span>
                      <span className="text-xs text-muted-foreground">산학협력단 공지</span>
                    </div>
                    <h3 className="text-sm font-semibold text-ink">
                      2026 AI 세미나 참가 신청 안내
                    </h3>
                  </div>
                  <span className="shrink-0 rounded-lg border border-line bg-canvas px-2 py-1 text-center text-xs font-semibold text-rose">
                    D-5
                  </span>
                </div>

                {/* AI Extracted Action Block */}
                <div className="space-y-2.5 rounded-xl border border-line bg-canvas p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      <Sparkles className="size-3.5 text-amber" />
                      해야 할 일 (Action)
                    </span>
                    <span className="rounded bg-rose-soft px-1.5 py-0.5 text-[11px] font-semibold text-rose">
                      필수 제출
                    </span>
                  </div>

                  <p className="text-sm font-medium text-ink">참가신청서 및 제안서 제출</p>

                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                    <div className="rounded-lg bg-surface p-2 border border-line/60">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="size-3 text-rose" />
                        마감일
                      </span>
                      <p className="mt-0.5 font-semibold text-ink">10월 31일 (금)</p>
                    </div>

                    <div className="rounded-lg bg-surface p-2 border border-line/60">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="size-3 text-ink" />
                        행사 일정
                      </span>
                      <p className="mt-0.5 font-semibold text-ink">11월 05일 14:00</p>
                    </div>
                  </div>
                </div>

                {/* Evidence Quote Box */}
                <div className="rounded-xl border border-line/80 bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <FileText className="size-3 text-faint" />
                    <span>추출 근거 (Evidence)</span>
                  </div>
                  <blockquote className="mt-1 text-xs text-ink/90 border-l-2 border-amber pl-2">
                    &ldquo;신청 마감일: 2026-10-31 (기한 이후 제출 불가)&rdquo;
                  </blockquote>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
