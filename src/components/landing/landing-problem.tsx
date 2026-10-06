import { AlertCircle, HelpCircle, CalendarX } from "lucide-react";

export function LandingProblem() {
  return (
    <section id="overview" className="border-y border-line bg-surface px-4 py-16 sm:px-6 sm:py-20 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            WHY AI HUB
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            흩어져 있는 정보, 반복되는 놓침
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            하루에도 수십 통씩 오는 공지와 파일 속에서 진짜 해야 할 일을 찾는 데 얼마나 많은 시간을 쓰고 계신가요?
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {/* Card 1: Mail */}
          <div className="rounded-2xl border border-line bg-canvas p-6 transition-transform hover:-translate-y-0.5">
            <div className="grid size-10 place-items-center rounded-xl bg-surface border border-line text-rose">
              <AlertCircle className="size-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">
              메일 속 마감 요청을 놓치고
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              매일 쏟아지는 안내 메일 속에서 정작 중요한 서류 제출 기한이나 신청 마감일을 제때 확인하지 못해 놓치기 일쑤입니다.
            </p>
          </div>

          {/* Card 2: Drive */}
          <div className="rounded-2xl border border-line bg-canvas p-6 transition-transform hover:-translate-y-0.5">
            <div className="grid size-10 place-items-center rounded-xl bg-surface border border-line text-amber">
              <HelpCircle className="size-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">
              Drive 문서는 다시 찾기 어렵고
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              제목이 정확히 기억나지 않는 기획서, 어느 폴더에 넣어뒀는지 잊어버린 양식을 찾느라 검색창만 반복해서 새로고침합니다.
            </p>
          </div>

          {/* Card 3: Calendar */}
          <div className="rounded-2xl border border-line bg-canvas p-6 transition-transform hover:-translate-y-0.5">
            <div className="grid size-10 place-items-center rounded-xl bg-surface border border-line text-ink">
              <CalendarX className="size-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">
              캘린더에는 일정만 있고
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              행사 날짜는 캘린더에 있지만, 사전에 준비하고 제출해야 하는 할 일(Action)은 따로 적어두지 않으면 잊혀집니다.
            </p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <p className="inline-block rounded-xl border border-line bg-surface px-5 py-3 text-sm font-medium text-ink shadow-sm sm:text-base">
            AI Hub는 흩어진 정보를 하나의 정보 흐름으로 연결합니다.
          </p>
        </div>
      </div>
    </section>
  );
}
