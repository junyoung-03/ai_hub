import type { SearchActionResult } from "@/types/search-ui";
import { actionDay, isOverdue, weekEnd } from "./schedule-model";

export type PlannerFilter = "all" | "today" | "week" | "upcoming" | "completed";
export const plannerSections = [
  { key: "overdue", label: "기한 지남" },
  { key: "today", label: "오늘" },
  { key: "week", label: "이번 주" },
  { key: "upcoming", label: "예정" },
  { key: "undated", label: "날짜 확인 · 미정" },
  { key: "completed", label: "완료" },
] as const;

export function plannerGroup(action: SearchActionResult, today: string, now: number): typeof plannerSections[number]["key"] {
  if (action.status === "completed") return "completed";
  const day = actionDay(action);
  if (!day) return "undated";
  if (isOverdue(action, today, now)) return "overdue";
  if (day === today) return "today";
  return day <= weekEnd(today) ? "week" : "upcoming";
}

export function matchesPlannerFilter(action: SearchActionResult, filter: PlannerFilter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return action.status === "completed";
  if (action.status === "completed") return false;
  const day = actionDay(action);
  if (!day) return false;
  if (filter === "today") return day === today;
  if (filter === "week") return day >= today && day <= weekEnd(today);
  return day > today;
}
