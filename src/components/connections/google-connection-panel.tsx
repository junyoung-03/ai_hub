"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Mail, Folder, CalendarDays, RefreshCw } from "lucide-react";
import { formatTimestamp, formatRelativeTime } from "@/lib/items/presentation";
import { runBoundedAnalysis } from "@/lib/items/browser-analysis";
import type { GoogleConnectionSummary, GoogleConnectionDetailSummary, GoogleServiceSyncStatus } from "@/lib/google/connections";

type ServiceUIState = {
  status: GoogleServiceSyncStatus;
  lastSyncedAt: string | null;
  resultText: string | null;
};

function parseInitialResultText(service: "gmail" | "drive" | "calendar", result: Record<string, unknown> | null | undefined): string | null {
  if (!result) return null;
  if (service === "gmail") {
    const created = typeof result.created_count === "number" ? result.created_count : 0;
    const updated = typeof result.updated_count === "number" ? result.updated_count : 0;
    const skipped = typeof result.skipped_count === "number" ? result.skipped_count : 0;
    const collected = typeof result.collected_count === "number" ? result.collected_count : 0;
    if (created > 0) return `새 항목 ${created}건`;
    if (updated > 0) return `항목 ${updated}건 갱신`;
    if (skipped > 0 || collected > 0) return "변경 없음";
    return "동기화 완료";
  }
  if (service === "drive") {
    const created = typeof result.created === "number" ? result.created : 0;
    const updated = typeof result.updated === "number" ? result.updated : 0;
    const reused = typeof result.reused === "number" ? result.reused : 0;
    if (created > 0) return `새 항목 ${created}건`;
    if (updated > 0) return `문서 ${updated}건 갱신`;
    if (reused > 0) return "변경 없음";
    return "동기화 완료";
  }
  if (service === "calendar") {
    const created = typeof result.created === "number" ? result.created : 0;
    const updated = typeof result.updated === "number" ? result.updated : 0;
    const reused = typeof result.reused === "number" ? result.reused : 0;
    const skipped = typeof result.skipped === "number" ? result.skipped : 0;
    if (created > 0) return `새 항목 ${created}건`;
    if (updated > 0) return `일정 ${updated}건 갱신`;
    if (reused > 0 || skipped > 0) return "변경 없음";
    return "동기화 완료";
  }
  return null;
}

export function GoogleConnectionPanel({
  connection,
  syncSummary,
  notice,
}: {
  connection: GoogleConnectionSummary | null;
  syncSummary?: GoogleConnectionDetailSummary | null;
  notice: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [driveTarget, setDriveTarget] = useState("");
  const [driveMode, setDriveMode] = useState("folder");

  const connected = connection?.status === "connected";

  const [serviceStates, setServiceStates] = useState<Record<"gmail" | "drive" | "calendar", ServiceUIState>>({
    gmail: {
      status: syncSummary?.services.gmail.status ?? (connected && connection?.capabilities.gmail ? "connected" : connected ? "reconnect_required" : "disconnected"),
      lastSyncedAt: syncSummary?.services.gmail.lastSyncedAt ?? connection?.lastSyncedAt ?? null,
      resultText: parseInitialResultText("gmail", syncSummary?.services.gmail.lastResult),
    },
    drive: {
      status: syncSummary?.services.drive.status ?? (connected && connection?.capabilities.drive ? "connected" : connected ? "reconnect_required" : "disconnected"),
      lastSyncedAt: syncSummary?.services.drive.lastSyncedAt ?? null,
      resultText: parseInitialResultText("drive", syncSummary?.services.drive.lastResult),
    },
    calendar: {
      status: syncSummary?.services.calendar.status ?? (connected && connection?.capabilities.calendar ? "connected" : connected ? "reconnect_required" : "disconnected"),
      lastSyncedAt: syncSummary?.services.calendar.lastSyncedAt ?? null,
      resultText: parseInitialResultText("calendar", syncSummary?.services.calendar.lastResult),
    },
  });

  async function executeGmailSync(): Promise<{ success: boolean; analysisItemIds: string[]; text: string }> {
    setServiceStates((prev) => ({
      ...prev,
      gmail: { ...prev.gmail, status: "syncing" },
    }));

    try {
      const response = await fetch("/api/v1/connections/google/sync", {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json();

      if (!response.ok || typeof payload !== "object" || payload === null) {
        const errorObj = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
        const errCode = typeof errorObj === "object" && errorObj !== null && "code" in errorObj ? String(errorObj.code) : "";
        const errMsg = typeof errorObj === "object" && errorObj !== null && "message" in errorObj && typeof errorObj.message === "string"
          ? errorObj.message
          : "메일 수집을 완료하지 못했습니다.";

        const nextStatus: GoogleServiceSyncStatus = response.status === 401 || errCode === "REFRESH_FAILED" || errCode === "TOKEN_MISSING" || errCode === "CONNECTION_REQUIRED"
          ? "reconnect_required"
          : "error";

        setServiceStates((prev) => ({
          ...prev,
          gmail: { ...prev.gmail, status: nextStatus, resultText: nextStatus === "reconnect_required" ? "재연결 필요" : "동기화 실패" },
        }));
        return { success: false, analysisItemIds: [], text: `Gmail: ${errMsg}` };
      }

      const p = payload as {
        collected_count?: number;
        created_count?: number;
        updated_count?: number;
        skipped_count?: number;
        failed_count?: number;
        capped?: boolean;
        analysisItemIds?: string[];
        analysisDiscoveryFailed?: boolean;
      };

      const created = p.created_count ?? 0;
      const updated = p.updated_count ?? 0;
      const skipped = p.skipped_count ?? 0;
      const collected = p.collected_count ?? 0;

      let resultText = "동기화 완료";
      if (created > 0) resultText = `새 항목 ${created}건`;
      else if (updated > 0) resultText = `항목 ${updated}건 갱신`;
      else if (skipped > 0 || collected > 0) resultText = "변경 없음";

      const now = new Date().toISOString();
      setServiceStates((prev) => ({
        ...prev,
        gmail: { status: "connected", lastSyncedAt: now, resultText },
      }));

      const summaryText = `Gmail: 수집 ${collected}건 · 신규 ${created}건 · 갱신 ${updated}건 · 기존 ${skipped}건${p.capped ? " (최대 100건)" : ""}`;
      const analysisIds = Array.isArray(p.analysisItemIds) ? p.analysisItemIds.filter((id): id is string => typeof id === "string") : [];
      return { success: true, analysisItemIds: analysisIds, text: summaryText };
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        gmail: { ...prev.gmail, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, analysisItemIds: [], text: "Gmail: 메일 수집을 완료하지 못했습니다." };
    }
  }

  async function executeDriveSync(): Promise<{ success: boolean; analysisItemIds: string[]; text: string }> {
    const target = driveTarget.trim();
    if (!target) {
      setServiceStates((prev) => ({
        ...prev,
        drive: { ...prev.drive, resultText: "수집 대상(폴더/파일) 설정 필요" },
      }));
      return { success: false, analysisItemIds: [], text: "Drive: 수집 대상(폴더/파일) 설정 필요" };
    }

    setServiceStates((prev) => ({
      ...prev,
      drive: { ...prev.drive, status: "syncing" },
    }));

    try {
      const body = driveMode === "folder"
        ? { mode: "folder", folderId: target }
        : { mode: "files", fileIds: target.split(/[\s,]+/).filter(Boolean) };

      const response = await fetch("/api/v1/connections/google/drive/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      const payload = await response.json() as {
        created?: number;
        updated?: number;
        reused?: number;
        failed?: number;
        unprocessed?: number;
        complete?: boolean;
        capped?: boolean;
        analysisItemIds?: string[];
        analysisDiscoveryFailed?: boolean;
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        const errCode = payload.error?.code ?? "";
        const errMsg = payload.error?.message ?? "Drive 수집을 완료하지 못했습니다.";
        const nextStatus: GoogleServiceSyncStatus = response.status === 401 || errCode === "REFRESH_FAILED" || errCode === "DRIVE_CONSENT_REQUIRED" || errCode === "CONNECTION_REQUIRED"
          ? "reconnect_required"
          : "error";

        setServiceStates((prev) => ({
          ...prev,
          drive: { ...prev.drive, status: nextStatus, resultText: nextStatus === "reconnect_required" ? "재연결 필요" : "동기화 실패" },
        }));
        return { success: false, analysisItemIds: [], text: `Drive: ${errMsg}` };
      }

      const created = payload.created ?? 0;
      const updated = payload.updated ?? 0;
      const reused = payload.reused ?? 0;

      let resultText = "동기화 완료";
      if (created > 0) resultText = `새 항목 ${created}건`;
      else if (updated > 0) resultText = `문서 ${updated}건 갱신`;
      else if (reused > 0) resultText = "변경 없음";

      const now = new Date().toISOString();
      setServiceStates((prev) => ({
        ...prev,
        drive: { status: "connected", lastSyncedAt: now, resultText },
      }));

      const summaryText = `Drive: 신규 ${created} · 갱신 ${updated} · 기존 ${reused}${!payload.complete || payload.capped ? " (일부 수집)" : " · 완료"}`;
      const analysisIds = Array.isArray(payload.analysisItemIds) ? payload.analysisItemIds : [];
      return { success: true, analysisItemIds: analysisIds, text: summaryText };
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        drive: { ...prev.drive, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, analysisItemIds: [], text: "Drive: 수집을 완료하지 못했습니다." };
    }
  }

  async function executeCalendarSync(): Promise<{ success: boolean; text: string }> {
    setServiceStates((prev) => ({
      ...prev,
      calendar: { ...prev.calendar, status: "syncing" },
    }));

    try {
      const response = await fetch("/api/v1/connections/google/calendar/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });

      const payload = await response.json() as {
        created?: number;
        updated?: number;
        reused?: number;
        skipped?: number;
        failed?: number;
        complete?: boolean;
        capped?: boolean;
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        const errCode = payload.error?.code ?? "";
        const errMsg = payload.error?.message ?? "Calendar 수집을 완료하지 못했습니다.";
        const nextStatus: GoogleServiceSyncStatus = response.status === 401 || errCode === "REFRESH_FAILED" || errCode === "CALENDAR_CONSENT_REQUIRED" || errCode === "CONNECTION_REQUIRED"
          ? "reconnect_required"
          : "error";

        setServiceStates((prev) => ({
          ...prev,
          calendar: { ...prev.calendar, status: nextStatus, resultText: nextStatus === "reconnect_required" ? "재연결 필요" : "동기화 실패" },
        }));
        return { success: false, text: `Calendar: ${errMsg}` };
      }

      const created = payload.created ?? 0;
      const updated = payload.updated ?? 0;
      const reused = payload.reused ?? 0;
      const skipped = payload.skipped ?? 0;

      let resultText = "동기화 완료";
      if (created > 0) resultText = `새 항목 ${created}건`;
      else if (updated > 0) resultText = `일정 ${updated}건 갱신`;
      else if (reused > 0 || skipped > 0) resultText = "변경 없음";

      const now = new Date().toISOString();
      setServiceStates((prev) => ({
        ...prev,
        calendar: { status: "connected", lastSyncedAt: now, resultText },
      }));

      const summaryText = `Calendar: 신규 ${created} · 갱신 ${updated} · 기존 ${reused + skipped}${!payload.complete || payload.capped ? " (일부 수집)" : " · 완료"}`;
      return { success: true, text: summaryText };
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        calendar: { ...prev.calendar, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, text: "Calendar: 수집을 완료하지 못했습니다." };
    }
  }

  async function syncIndividual(service: "gmail" | "drive" | "calendar") {
    setPending(`sync-${service}`);
    setMessage(null);
    setSyncResult(null);

    try {
      if (service === "gmail") {
        const res = await executeGmailSync();
        setSyncResult(res.text);
        if (res.analysisItemIds.length > 0) {
          await runBoundedAnalysis(res.analysisItemIds, setMessage);
        }
      } else if (service === "drive") {
        if (!driveTarget.trim()) {
          setMessage("Drive 수집 대상을 먼저 지정해 주세요 (아래 '수집 대상 폴더/파일 및 권한 설정'에서 폴더 ID 또는 파일 ID 입력).");
          setPending(null);
          return;
        }
        const res = await executeDriveSync();
        setSyncResult(res.text);
        if (res.analysisItemIds.length > 0) {
          await runBoundedAnalysis(res.analysisItemIds, setMessage);
        }
      } else if (service === "calendar") {
        const res = await executeCalendarSync();
        setSyncResult(res.text);
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "동기화에 실패했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function syncAll() {
    setPending("sync-all");
    setMessage(null);
    setSyncResult(null);

    const summaries: string[] = [];
    const allAnalysisIds: string[] = [];

    try {
      // 1. Gmail
      const gmailRes = await executeGmailSync();
      summaries.push(gmailRes.text);
      allAnalysisIds.push(...gmailRes.analysisItemIds);

      // 2. Drive (continues even if Gmail failed)
      const driveRes = await executeDriveSync();
      summaries.push(driveRes.text);
      allAnalysisIds.push(...driveRes.analysisItemIds);

      // 3. Calendar (continues even if previous failed)
      const calRes = await executeCalendarSync();
      summaries.push(calRes.text);

      setSyncResult(summaries.join(" | "));

      if (allAnalysisIds.length > 0) {
        await runBoundedAnalysis(allAnalysisIds, setMessage);
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "전체 동기화 중 오류가 발생했습니다.");
    } finally {
      setPending(null);
    }
  }

  async function connect(purpose: "connect" | "drive_scope_upgrade" | "calendar_scope_upgrade" = "connect") {
    setPending(purpose);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/connections/google/authorize", {
        method: "POST",
        headers: { Accept: "application/json", ...(purpose !== "connect" ? { "Content-Type": "application/json" } : {}) },
        ...(purpose !== "connect" ? { body: JSON.stringify({ purpose }) } : {}),
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== "object" || payload === null) {
        throw new Error("Connection unavailable.");
      }
      const authorizationUrl = "authorizationUrl" in payload && typeof payload.authorizationUrl === "string"
        ? payload.authorizationUrl
        : null;
      if (!authorizationUrl) {
        const errorMessage = "error" in payload && typeof payload.error === "object" && payload.error !== null
          && "message" in payload.error && typeof payload.error.message === "string"
          ? payload.error.message
          : "Google 연결을 시작하지 못했습니다.";
        setMessage(errorMessage);
        setPending(null);
        return;
      }
      const target = new URL(authorizationUrl);
      if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth") {
        throw new Error("Invalid authorization destination.");
      }
      window.location.assign(target.toString());
    } catch {
      setPending(null);
      setMessage("Google 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function disconnect() {
    setPending("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/connections/google/disconnect", {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        const errorMessage = typeof payload === "object" && payload !== null
          && "error" in payload && typeof payload.error === "object" && payload.error !== null
          && "message" in payload.error && typeof payload.error.message === "string"
          ? payload.error.message
          : "Google 연결을 해제하지 못했습니다.";
        setMessage(errorMessage);
        setPending(null);
        return;
      }
      router.refresh();
      setPending(null);
    } catch {
      setPending(null);
      setMessage("Google 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function renderStatusBadge(state: ServiceUIState) {
    let colorClass = "bg-stone-300";
    let text = "연결 안 됨";

    if (state.status === "syncing") {
      colorClass = "bg-sky-500 animate-pulse";
      text = "동기화 중…";
    } else if (state.status === "connected") {
      colorClass = "bg-emerald-500";
      text = "정상";
    } else if (state.status === "reconnect_required") {
      colorClass = "bg-amber-500";
      text = "재연결 필요";
    } else if (state.status === "error") {
      colorClass = "bg-rose-500";
      text = "오류";
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`inline-block size-2 rounded-full ${colorClass}`} aria-hidden="true" />
        <span className="font-medium text-foreground">{text}</span>
        {state.lastSyncedAt && (
          <span className="text-muted-foreground">· {formatRelativeTime(state.lastSyncedAt)}</span>
        )}
      </div>
    );
  }

  const anyReconnectRequired = serviceStates.gmail.status === "reconnect_required"
    || serviceStates.drive.status === "reconnect_required"
    || serviceStates.calendar.status === "reconnect_required"
    || connection?.status === "error";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-medium">연결된 서비스</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Gmail · Drive · Calendar의 동기화 상태를 확인하고 수동으로 최신 정보를 수집합니다.
        </p>
      </div>

      {/* Google Account Summary Card */}
      <div className="rounded-xl border border-line bg-surface px-5 py-4">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Google 계정</dt>
            <dd className={anyReconnectRequired ? "text-amber-600 dark:text-amber-400 font-medium" : connected ? "text-green font-medium" : "text-muted-foreground"}>
              {anyReconnectRequired ? "재연결 필요" : connected ? "연결됨" : connection?.status === "error" ? "연결 오류" : "연결되지 않음"}
            </dd>
          </div>
          {connection?.accountEmail && (
            <div>
              <dt className="sr-only">연결된 이메일</dt>
              <dd className="break-all font-mono text-xs">{connection.accountEmail}</dd>
            </div>
          )}
          {connection?.lastSyncedAt && (
            <div className="meta">
              <dt className="inline">마지막 동기화 · </dt>
              <dd className="inline">{formatTimestamp(connection.lastSyncedAt)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {connected && (
            <button
              type="button"
              onClick={syncAll}
              disabled={pending !== null}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${pending === "sync-all" ? "animate-spin" : ""}`} aria-hidden="true" />
              {pending === "sync-all" ? "전체 동기화 중…" : "전체 동기화"}
            </button>
          )}
          <button
            type="button"
            onClick={() => connect()}
            disabled={pending !== null}
            className={anyReconnectRequired ? "btn-primary" : "btn-secondary"}
          >
            {pending === "connect" ? "연결 준비 중…" : anyReconnectRequired ? "Google 다시 연결" : connected ? "Google 다시 연결" : "Google 계정 연결"}
          </button>
          {connected && (
            <button
              type="button"
              onClick={disconnect}
              disabled={pending !== null}
              className="btn-secondary text-destructive"
            >
              {pending === "disconnect" ? "연결 해제 중…" : "연결 해제"}
            </button>
          )}
        </div>
      </div>

      {/* Services List with Sync Controls */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
        {/* Gmail Service */}
        <section className="px-5 py-4">
          <div className="flex items-start justify-between gap-3.5">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas">
                <Mail className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Gmail</h3>
                </div>
                <div className="mt-1">
                  {renderStatusBadge(serviceStates.gmail)}
                </div>
                {serviceStates.gmail.resultText && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {serviceStates.gmail.resultText}
                  </p>
                )}
                <p className="meta mt-1">최근 30일 받은편지함 · 최대 100건</p>
              </div>
            </div>
            {connected && (
              <div className="flex items-center gap-1.5 shrink-0">
                {serviceStates.gmail.status === "reconnect_required" && (
                  <button
                    type="button"
                    onClick={() => connect()}
                    disabled={pending !== null}
                    className="btn-secondary text-xs shrink-0 text-amber-600 dark:text-amber-400"
                  >
                    {pending === "connect" ? "연결 준비…" : "Google 다시 연결"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => syncIndividual("gmail")}
                  disabled={pending !== null || !connection?.capabilities.gmail}
                  className="btn-secondary text-xs shrink-0"
                >
                  {pending === "sync-gmail" || (pending === "sync-all" && serviceStates.gmail.status === "syncing")
                    ? "동기화 중…"
                    : "지금 동기화"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Google Drive Service */}
        <section className="px-5 py-4">
          <div className="flex items-start justify-between gap-3.5">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas">
                <Folder className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Google Drive</h3>
                </div>
                <div className="mt-1">
                  {renderStatusBadge(serviceStates.drive)}
                </div>
                {serviceStates.drive.resultText && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {serviceStates.drive.resultText}
                  </p>
                )}
                <p className="meta mt-1">Google Docs 문서 수집</p>
              </div>
            </div>
            {connected && (
              <div className="flex items-center gap-1.5 shrink-0">
                {serviceStates.drive.status === "reconnect_required" && (
                  <button
                    type="button"
                    onClick={() => connect()}
                    disabled={pending !== null}
                    className="btn-secondary text-xs shrink-0 text-amber-600 dark:text-amber-400"
                  >
                    {pending === "connect" ? "연결 준비…" : "Google 다시 연결"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => syncIndividual("drive")}
                  disabled={pending !== null || !connection?.capabilities.drive}
                  className="btn-secondary text-xs shrink-0"
                >
                  {pending === "sync-drive" || (pending === "sync-all" && serviceStates.drive.status === "syncing")
                    ? "동기화 중…"
                    : "지금 동기화"}
                </button>
              </div>
            )}
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              수집 대상 폴더/파일 및 권한 설정
            </summary>
            <div className="mt-3 space-y-3 rounded-lg bg-canvas p-3 text-xs">
              {connected && !connection?.capabilities.drive && (
                <button
                  type="button"
                  onClick={() => connect("drive_scope_upgrade")}
                  disabled={pending !== null}
                  className="btn-secondary text-xs"
                >
                  {pending === "drive_scope_upgrade" ? "동의 준비 중…" : "Drive/Docs 읽기 권한 추가"}
                </button>
              )}
              <label className="block text-xs font-medium">
                수집 방식
                <select
                  className="field mt-1 text-xs"
                  value={driveMode}
                  onChange={(e) => setDriveMode(e.target.value)}
                >
                  <option value="folder">특정 폴더 ID (비워두면 최상위 내 드라이브)</option>
                  <option value="files">특정 파일 ID 목록 (최대 20개)</option>
                </select>
              </label>
              <label className="block text-xs font-medium">
                {driveMode === "folder" ? "폴더 ID (선택사항)" : "파일 ID (쉼표나 줄바꿈으로 구분)"}
                <textarea
                  className="field mt-1 text-xs font-mono"
                  rows={2}
                  value={driveTarget}
                  placeholder={driveMode === "folder" ? "비워두면 '내 드라이브' 루트 폴더 수집" : "파일 ID 입력"}
                  onChange={(e) => setDriveTarget(e.target.value)}
                />
              </label>
            </div>
          </details>
        </section>

        {/* Google Calendar Service */}
        <section className="px-5 py-4">
          <div className="flex items-start justify-between gap-3.5">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas">
                <CalendarDays className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Google Calendar</h3>
                </div>
                <div className="mt-1">
                  {renderStatusBadge(serviceStates.calendar)}
                </div>
                {serviceStates.calendar.resultText && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {serviceStates.calendar.resultText}
                  </p>
                )}
                <p className="meta mt-1">기본 캘린더 · 일정 날짜와 행동 마감 구분</p>
              </div>
            </div>
            {connected && (
              <div className="flex items-center gap-1.5 shrink-0">
                {serviceStates.calendar.status === "reconnect_required" && (
                  <button
                    type="button"
                    onClick={() => connect()}
                    disabled={pending !== null}
                    className="btn-secondary text-xs shrink-0 text-amber-600 dark:text-amber-400"
                  >
                    {pending === "connect" ? "연결 준비…" : "Google 다시 연결"}
                  </button>
                )}
                {!connection?.capabilities.calendar && serviceStates.calendar.status !== "reconnect_required" && (
                  <button
                    type="button"
                    onClick={() => connect("calendar_scope_upgrade")}
                    disabled={pending !== null}
                    className="btn-secondary text-xs"
                  >
                    {pending === "calendar_scope_upgrade" ? "동의 준비…" : "권한 추가"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => syncIndividual("calendar")}
                  disabled={pending !== null || !connection?.capabilities.calendar}
                  className="btn-secondary text-xs"
                >
                  {pending === "sync-calendar" || (pending === "sync-all" && serviceStates.calendar.status === "syncing")
                    ? "동기화 중…"
                    : "지금 동기화"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {syncResult && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">{syncResult}</p>}

      <p className="text-sm leading-6 text-muted-foreground">
        Gmail·Drive 수집 후 미분석·변경 자료의 본문을 Gemini로 보내 최대 3건씩 분석합니다. 민감한 자료는 수집하지 마세요. Calendar는 자동 분석에서 제외합니다.
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        연결 해제는 신규 수집을 중단하며 기존 자료·검색·할 일은 유지합니다.
      </p>
      <Link href="/library" className="inline-block text-sm underline-offset-4 hover:underline">
        수집된 자료 확인 →
      </Link>
    </div>
  );
}