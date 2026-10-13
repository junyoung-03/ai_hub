"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { TodayCalendar } from "./today-calendar";
import { TodayTodoList } from "./today-todo-list";
import { AddTodoModal } from "./add-todo-modal";
import { useActions, useScheduleItems } from "@/components/actions/use-workspace-data";
import { eventsFromDetail } from "@/components/actions/schedule-model";

const searchChips = [
  "이번 주 할 일",
  "계약",
  "오늘 할 일",
  "회의",
];

export function TodayDashboard({
  today,
  initialAddModal = false,
}: {
  today: string;
  initialAddModal?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(initialAddModal);
  const [modalInitialDate, setModalInitialDate] = useState(today);

  const actions = useActions("open");
  const schedule = useScheduleItems(true);

  const allActions = actions.rows;

  const events = Object.values(schedule.details)
    .flatMap(eventsFromDetail)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
  const eventEnds = Object.fromEntries(Object.values(schedule.details).flatMap(detail => {
    const end = detail.calendar?.end;
    return end && "dateTime" in end ? [[`calendar:${detail.item.id}`, end.dateTime]] : [];
  }));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleChipClick = (chip: string) => {
    router.push(`/search?q=${encodeURIComponent(chip)}`);
  };

  const openAddModal = (date?: string) => {
    setModalInitialDate(date || today);
    setIsAddModalOpen(true);
  };

  const handleActionAdded = () => { actions.reload(); };

  return (
    <div className="home-dashboard space-y-5">
      {/* 1. Header: 타이틀 + 간단하고 정돈된 검색창 UI */}
      <section aria-labelledby="today-title" className="home-search space-y-3">
        <div className="flex flex-col gap-3">
          <div>
            <h1 id="today-title" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              오늘
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
              내 일정과 해야 할 일을 한눈에 확인하세요.
            </p>
          </div>

          {/* 간단한 검색창 UI */}
          <form
            onSubmit={handleSearch}
            className="flex min-h-14 w-full items-center rounded-2xl border border-blue-100 bg-white/95 px-4 py-2 shadow-[0_2px_10px_#2563eb08] transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100"
          >
            <Search className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="통합 검색어"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="자료, 일정, 할 일 등 무엇이든 물어보세요..."
              className="w-full bg-transparent px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              aria-label="검색 실행"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </form>
        </div>

        {/* 보조 검색 칩 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {searchChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleChipClick(chip)}
              className="inline-flex items-center rounded-full border border-slate-200/60 bg-white px-3.5 py-1 text-[13px] text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800"
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* 2. 메인 Layout: Large Calendar (화면의 약 80%) : Todo Panel (약 20%) */}
      <div className="home-calendar-layout grid grid-cols-1 gap-4 items-start">
        {/* Large Calendar (약 80%) */}
        <div className="min-w-0">
          <TodayCalendar
            today={today}
            actions={allActions}
            events={events}
            busy={actions.busy || schedule.busy}
            onAddAction={openAddModal}
          />
        </div>

        {/* 오른쪽 오늘 할 일 (약 20%) */}
        <div className="min-w-0">
          <TodayTodoList
            today={today}
            actions={allActions}
            events={events}
            eventEnds={eventEnds}
            busy={actions.busy}
            scheduleBusy={schedule.busy}
            error={actions.error}
            scheduleError={schedule.error}
          />
        </div>
      </div>

      {/* 간단한 Memo UI: 월·일·시간·제목 4개 필드만 있는 모달 */}
      {isAddModalOpen && (
        <AddTodoModal
          key={`${modalInitialDate}-${isAddModalOpen}`}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          initialDate={modalInitialDate}
          onAdded={handleActionAdded}
        />
      )}
    </div>
  );
}
