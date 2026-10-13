"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { SearchActionResult } from "@/types/search-ui";

interface AddTodoModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate: string; // "YYYY-MM-DD"
  onAdded: (action: SearchActionResult) => void;
  editingAction?: SearchActionResult;
}

const subscribe = () => () => {};

export function AddTodoModal({
  isOpen,
  onClose,
  initialDate,
  onAdded,
  editingAction,
}: AddTodoModalProps) {
  // Parse year, month, day from initialDate or today
  const parsed = initialDate ? new Date(initialDate) : new Date();
  const year = isNaN(parsed.getFullYear()) ? new Date().getFullYear() : parsed.getFullYear();
  const initialMonth = isNaN(parsed.getMonth()) ? new Date().getMonth() + 1 : parsed.getMonth() + 1;
  const initialDay = isNaN(parsed.getDate()) ? new Date().getDate() : parsed.getDate();

  const [month, setMonth] = useState<number>(initialMonth);
  const [day, setDay] = useState<number>(initialDay);
  const [time, setTime] = useState<string>(editingAction?.deadlineAt ? new Intl.DateTimeFormat("en-GB", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul"}).format(new Date(editingAction.deadlineAt)) : editingAction ? "" : "14:00");
  const [title, setTitle] = useState<string>(editingAction?.title ?? "");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !mounted) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleInputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [isOpen, mounted]);

  if (!isOpen || !mounted) return null;

  // Days in month calculation for the year & selected month
  const daysInMonth = new Date(year, month, 0).getDate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("할 일 제목을 입력해 주세요.");
      return;
    }

    const safeDay = Math.min(day, daysInMonth);
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;

    setSubmitting(true);
    setError("");

    try {
      // Direct Manual Action creation (NO manual text item, NO upload, NO Gemini analysis)
      const res = await fetch(editingAction ? `/api/v1/actions/${editingAction.actionId}` : "/api/v1/actions", {
        method: editingAction ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          date: dateStr,
          time: time.trim() || null,
        }),
      });

      if (!res.ok) {
        throw new Error("할 일을 저장하지 못했습니다.");
      }

      const data: { action?: SearchActionResult; actionId?: string } = await res.json();
      if (editingAction ? data.actionId !== editingAction.actionId : !data.action?.actionId) throw new Error("저장 결과를 확인하지 못했습니다. 할 일 목록을 확인해 주세요.");
      onAdded(editingAction ? { ...editingAction, title: trimmedTitle, deadlineDate: dateStr, deadlineAt: time ? `${dateStr}T${time}:00+09:00` : null } : data.action!);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ai-hub:actions-changed"));
      }

      setTitle("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "할 일을 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-todo-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, select"));
          const first = fields[0], last = fields.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      // Viewport-wide subtle translucent overlay: rgba(15, 23, 42, 0.18) with gentle 5px blur
      // NO border, NO radius, NO shadow on the backdrop itself to prevent box artifacts
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/[0.18] backdrop-blur-[5px] transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Standalone floating memo card: width 380~420px, rounded-[20px], soft shadow */}
      <div className="w-full max-w-[400px] rounded-[20px] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.15)] border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4.5 pb-3 border-b border-slate-100">
          <h2 id="add-todo-title" className="text-base font-semibold text-slate-900">
            {editingAction ? "할 일 수정" : "할 일 추가"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form: Exactly 4 fields (Month, Day, Time, Title) */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
              {error}
            </div>
          )}

          {/* 1. Date: Month & Day */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              날짜
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <select
                  aria-label="월"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none font-medium text-slate-800 cursor-pointer"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}월
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  ▼
                </span>
              </div>

              <div className="relative">
                <select
                  aria-label="일"
                  value={Math.min(day, daysInMonth)}
                  onChange={(e) => setDay(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none font-medium text-slate-800 cursor-pointer"
                >
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}일
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  ▼
                </span>
              </div>
            </div>
          </div>

          {/* 2. Time */}
          <div>
            <label htmlFor="quick-todo-time" className="block text-xs font-semibold text-slate-700 mb-1.5">
              시간
            </label>
            <input
              id="quick-todo-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="14:00"
              maxLength={5}
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder:text-slate-400"
            />
          </div>

          {/* 3. Title */}
          <div>
            <label htmlFor="quick-todo-text" className="block text-xs font-semibold text-slate-700 mb-1.5">
              할 일
            </label>
            <input
              ref={titleInputRef}
              id="quick-todo-text"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="코딩테스트 준비"
              maxLength={200}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder:text-slate-400"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
            >
              {submitting ? "저장 중..." : editingAction ? "저장" : "추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}
