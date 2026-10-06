import { Search, Smartphone, CheckCircle, Tag, Clock } from "lucide-react";

export function LandingBento() {
  return (
    <section id="bento" className="px-4 py-16 sm:px-6 sm:py-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            PRODUCT CAPABILITIES
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            생산성을 극대화하는 핵심 기능
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            단순 파일 저장이 아닌, 업무와 일정의 실제 흐름을 완전히 제어할 수 있는 도구를 제공합니다.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Bento 1: Large Span - Unified Search */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm md:col-span-2">
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Search className="size-5" />
                </span>
                <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-ink">
                  하이브리드 검색
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-ink">
                자연어 통합 검색 및 원문 인용
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                &ldquo;이번 주 제출할 장학금 서류&rdquo;처럼 질문하면 키워드와 벡터(pgvector) 검색을 결합해 가장 정확한 자료와 해야 할 일을 찾아냅니다.
              </p>
            </div>

            {/* Synthetic Search Bar Mock */}
            <div className="mt-6 rounded-xl border border-line bg-canvas p-4 space-y-3">
              <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted-foreground">
                <Search className="size-4 text-faint" />
                <span className="text-ink font-medium">이번 주 마감 서류</span>
                <span className="ml-auto rounded bg-brand-soft px-1.5 py-0.5 text-[10px] text-ink font-semibold">1건 일치</span>
              </div>
              <div className="rounded-lg border border-line/60 bg-surface p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink">2학기 국가근로 신청서 제출</span>
                  <span className="text-rose font-semibold">D-2</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  근거: &ldquo;제출 마감: 10월 28일 18:00까지 학생지원과&rdquo;
                </p>
              </div>
            </div>
          </div>

          {/* Bento 2: D-Day & Action Status */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-rose">
                  <Clock className="size-5" />
                </span>
                <span className="rounded bg-rose-soft px-2 py-0.5 text-xs font-semibold text-rose">
                  D-Day 레일
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-ink">
                실시간 D-Day 마감 관리
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                확정된 마감일만 D-Day로 계산하며, 불명확한 일정은 &lsquo;확인 필요&rsquo;로 분리합니다.
              </p>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-3 py-2 text-xs">
                <span className="font-medium text-ink">공모전 기획서 접수</span>
                <span className="rounded bg-rose px-2 py-0.5 font-bold text-white text-[11px]">D-DAY</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-3 py-2 text-xs">
                <span className="font-medium text-ink">세미나 사전 신청</span>
                <span className="rounded bg-amber-soft px-2 py-0.5 font-semibold text-amber text-[11px]">D-5</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-3 py-2 text-xs">
                <span className="font-medium text-ink">멘토링 일정 조율</span>
                <span className="rounded bg-surface px-2 py-0.5 font-medium text-muted-foreground border border-line text-[11px]">마감일 없음</span>
              </div>
            </div>
          </div>

          {/* Bento 3: AI Classification */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Tag className="size-5" />
                </span>
                <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-ink">
                  9대 유형
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-ink">
                AI 9대 문서 자동 분류
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                공지·안내, 신청·접수, 계약·약관, 결제·청구, 증명·제출서류 등 실용적인 유형으로 자동 태깅됩니다.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-1.5">
              {["공지·안내", "신청·접수", "계약·약관", "결제·청구", "예약·확인", "증명서류", "일정·초대"].map((type) => (
                <span key={type} className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs text-ink/80">
                  {type}
                </span>
              ))}
            </div>
          </div>

          {/* Bento 4: Evidence & Transparency */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-green">
                  <CheckCircle className="size-5" />
                </span>
                <span className="rounded bg-green-soft px-2 py-0.5 text-xs font-semibold text-green">
                  근거 검증
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-ink">
                원문 구절 추적 (Evidence)
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                모든 추출된 행동과 마감일은 원문 내 글자 위치(Offset)와 인용 구절을 직접 연결해 오판을 방지합니다.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-line bg-canvas p-3.5 text-xs">
              <span className="font-semibold text-ink">근거 추적 원칙</span>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                출처가 없는 마감일은 임의 생성하지 않으며, 검증 가능한 증거 문맥만을 제시합니다.
              </p>
            </div>
          </div>

          {/* Bento 5: Responsive & Multi-device */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Smartphone className="size-5" />
                </span>
                <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-ink">
                  반응형 최적화
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-ink">
                모바일 & 데스크톱 완벽 대응
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                데스크톱 2단 뷰부터 모바일 하단 내비게이션 바까지 어느 기기에서나 일관된 생산성을 제공합니다.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-line bg-canvas p-3.5 text-xs text-muted-foreground">
              가로 스크롤 없이 부드럽게 재배치되는 반응형 컴포넌트로 이동 중에도 할 일을 놓치지 않습니다.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
