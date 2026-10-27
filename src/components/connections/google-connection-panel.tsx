"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Mail, Folder, CalendarDays, RefreshCw } from "lucide-react";
import { formatTimestamp, formatRelativeTime } from "@/lib/items/presentation";
import { runBoundedAnalysis } from "@/lib/items/browser-analysis";
import { collectionOutcome, latestSyncTimestamp, type CollectionService } from "@/lib/google/sync-outcome";
import type { GoogleConnectionSummary, GoogleConnectionDetailSummary, GoogleServiceSyncStatus } from "@/lib/google/connections";

type ServiceUIState = {
  status: GoogleServiceSyncStatus | "partial";
  lastSyncedAt: string | null;
  resultText: string | null;
};

type ServiceRunResult = { success: boolean; analysisItemIds: string[]; analysisDiscoveryFailed: boolean; text: string };

function parseInitialResultText(service: CollectionService, result: Record<string, unknown> | null | undefined): string | null {
  return result ? collectionOutcome(service, result).text : null;
}

function initialStatus(service: CollectionService, status: GoogleServiceSyncStatus, result: Record<string, unknown> | null | undefined): ServiceUIState["status"] {
  if (status !== "connected" || !result) return status;
  const outcome = collectionOutcome(service, result);
  return outcome.kind === "failed" ? "error" : outcome.kind === "partial" ? "partial" : status;
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
  const [syncIssue, setSyncIssue] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [driveTarget, setDriveTarget] = useState("");
  const [driveMode, setDriveMode] = useState("folder");

  const connected = connection?.status === "connected";

  const [serviceStates, setServiceStates] = useState<Record<"gmail" | "drive" | "calendar", ServiceUIState>>({
    gmail: {
      status: initialStatus("gmail", syncSummary?.services.gmail.status ?? (connected && connection?.capabilities.gmail ? "connected" : connected ? "reconnect_required" : "disconnected"), syncSummary?.services.gmail.lastResult),
      lastSyncedAt: syncSummary?.services.gmail.lastSyncedAt ?? null,
      resultText: parseInitialResultText("gmail", syncSummary?.services.gmail.lastResult),
    },
    drive: {
      status: initialStatus("drive", syncSummary?.services.drive.status ?? (connected && connection?.capabilities.drive ? "connected" : connected ? "reconnect_required" : "disconnected"), syncSummary?.services.drive.lastResult),
      lastSyncedAt: syncSummary?.services.drive.lastSyncedAt ?? null,
      resultText: parseInitialResultText("drive", syncSummary?.services.drive.lastResult),
    },
    calendar: {
      status: initialStatus("calendar", syncSummary?.services.calendar.status ?? (connected && connection?.capabilities.calendar ? "connected" : connected ? "reconnect_required" : "disconnected"), syncSummary?.services.calendar.lastResult),
      lastSyncedAt: syncSummary?.services.calendar.lastSyncedAt ?? null,
      resultText: parseInitialResultText("calendar", syncSummary?.services.calendar.lastResult),
    },
  });

  function finishCollection(service: CollectionService, payload: unknown): ServiceRunResult {
    const outcome = collectionOutcome(service, payload);
    setServiceStates(prev => ({
      ...prev, [service]: {
        status: outcome.kind === "complete" ? "connected" : outcome.kind === "partial" ? "partial" : "error",
        lastSyncedAt: latestSyncTimestamp(prev[service].lastSyncedAt, outcome.lastSyncedAt),
        resultText: outcome.text,
      },
    }));
    return { success: outcome.kind === "complete", analysisItemIds: outcome.analysisItemIds,
      analysisDiscoveryFailed: outcome.analysisDiscoveryFailed, text: outcome.text };
  }

  async function analyzeCollected(ids: string[], discoveryFailed: boolean) {
    if (!ids.length && !discoveryFailed) return;
    if (!ids.length) {
      setAnalysisFailed(true);
      setAnalysisMessage("AI 분석 대상 확인에 실패했습니다. 수집된 자료는 유지됩니다. 자료 상세에서 분석을 다시 요청해 주세요.");
      return;
    }
    try {
      const result = await runBoundedAnalysis(ids, setAnalysisMessage);
      setAnalysisFailed(result.failed > 0 || discoveryFailed);
      setAnalysisMessage(result.message + (discoveryFailed ? " · 일부 수집 자료의 분석 대상 확인 실패" : ""));
    } catch {
      setAnalysisFailed(true);
      setAnalysisMessage("후속 AI 분석 결과를 확인하지 못했습니다. 수집된 자료는 유지됩니다.");
    }
  }

  async function executeGmailSync(): Promise<ServiceRunResult> {
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
        return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: `Gmail: ${errMsg}` };
      }

      return finishCollection("gmail", payload);
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        gmail: { ...prev.gmail, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: "Gmail: 메일 수집을 완료하지 못했습니다." };
    }
  }

  async function executeDriveSync(): Promise<ServiceRunResult> {
    const target = driveTarget.trim();
    if (!target) {
      setServiceStates((prev) => ({
        ...prev,
        drive: { ...prev.drive, resultText: "수집 대상(폴더/파일) 설정 필요" },
      }));
      return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: "Drive: 수집 대상(폴더/파일) 설정 필요" };
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
        return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: `Drive: ${errMsg}` };
      }

      return finishCollection("drive", payload);
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        drive: { ...prev.drive, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: "Drive: 수집을 완료하지 못했습니다." };
    }
  }

  async function executeCalendarSync(): Promise<ServiceRunResult> {
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
        return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: `Calendar: ${errMsg}` };
      }

      return finishCollection("calendar", payload);
    } catch {
      setServiceStates((prev) => ({
        ...prev,
        calendar: { ...prev.calendar, status: "error", resultText: "동기화 실패" },
      }));
      return { success: false, analysisItemIds: [], analysisDiscoveryFailed: false, text: "Calendar: 수집을 완료하지 못했습니다." };
    }
  }

  async function syncIndividual(service: "gmail" | "drive" | "calendar") {
    setPending(`sync-${service}`);
    setMessage(null);
    setSyncResult(null);
    setSyncIssue(false);
    setAnalysisMessage(null);
    setAnalysisFailed(false);

    try {
      if (service === "gmail") {
        const res = await executeGmailSync();
        setSyncResult(res.text);
        setSyncIssue(!res.success);
        await analyzeCollected(res.analysisItemIds, res.analysisDiscoveryFailed);
      } else if (service === "drive") {
        if (!driveTarget.trim()) {
          setMessage("Drive 수집 대상을 먼저 지정해 주세요 (아래 '수집 대상 폴더/파일 및 권한 설정'에서 폴더 ID 또는 파일 ID 입력).");
          setPending(null);
          return;
        }
        const res = await executeDriveSync();
        setSyncResult(res.text);
        setSyncIssue(!res.success);
        await analyzeCollected(res.analysisItemIds, res.analysisDiscoveryFailed);
      } else if (service === "calendar") {
        const res = await executeCalendarSync();
        setSyncResult(res.text);
        setSyncIssue(!res.success);
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
    setSyncIssue(false);
    setAnalysisMessage(null);
    setAnalysisFailed(false);

    const summaries: string[] = [];
    const allAnalysisIds: string[] = [];
    let collectionIssue = false, discoveryFailed = false;

    try {
      // 1. Gmail
      const gmailRes = await executeGmailSync();
      summaries.push(gmailRes.text);
      allAnalysisIds.push(...gmailRes.analysisItemIds);
      collectionIssue ||= !gmailRes.success;
      discoveryFailed ||= gmailRes.analysisDiscoveryFailed;

      // 2. Drive (continues even if Gmail failed)
      const driveRes = await executeDriveSync();
      summaries.push(driveRes.text);
      allAnalysisIds.push(...driveRes.analysisItemIds);
      collectionIssue ||= !driveRes.success;
      discoveryFailed ||= driveRes.analysisDiscoveryFailed;

      // 3. Calendar (continues even if previous failed)
      const calRes = await executeCalendarSync();
      summaries.push(calRes.text);
      collectionIssue ||= !calRes.success;

      setSyncResult(summaries.join(" | "));
      setSyncIssue(collectionIssue);

      await analyzeCollected(allAnalysisIds, discoveryFailed);
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

  function renderStatusBadge(state: ServiceUIState, service: CollectionService) {
    let colorClass = "bg-stone-300";
    let text = "연결 안 됨";

    if (state.status === "syncing") {
      colorClass = "bg-sky-500 animate-pulse";
      text = "동기화 중…";
    } else if (state.status === "connected") {
      colorClass = "bg-emerald-500";
      text = "연결됨";
    } else if (state.status === "partial") {
      colorClass = "bg-amber-500";
      text = "일부 수집";
    } else if (state.status === "reconnect_required") {
      colorClass = "bg-amber-500";
      text = "재연결 필요";
    } else if (state.status === "error") {
      colorClass = "bg-rose-500";
      text = "오류";
    }

    const lastSyncedAt = latestSyncTimestamp(state.lastSyncedAt, syncSummary?.services[service].lastSyncedAt);
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`inline-block size-2 rounded-full ${colorClass}`} aria-hidden="true" />
        <span className="font-medium text-foreground">{text}</span>
        {lastSyncedAt ? (
          <span className="text-muted-foreground">· 마지막 성공 {formatRelativeTime(lastSyncedAt)}</span>
        ) : <span className="text-muted-foreground">· 최근 성공 기록 없음</span>}
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
                  {renderStatusBadge(serviceStates.gmail, "gmail")}
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
                  {renderStatusBadge(serviceStates.drive, "drive")}
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
              <label htmlFor="drive-mode" className="block text-xs font-medium">
                수집 방식
                <select
                  id="drive-mode"
                  className="field mt-1 text-xs"
                  value={driveMode}
                  onChange={(e) => setDriveMode(e.target.value)}
                >
                  <option value="folder">특정 폴더 ID</option>
                  <option value="files">특정 파일 ID 목록 (최대 20개)</option>
                </select>
              </label>
              <label htmlFor="drive-target" className="block text-xs font-medium">
                {driveMode === "folder" ? "폴더 ID" : "파일 ID (쉼표나 줄바꿈으로 구분)"}
                <textarea
                  id="drive-target"
                  className="field mt-1 text-xs font-mono"
                  rows={2}
                  value={driveTarget}
                  placeholder={driveMode === "folder" ? "수집할 폴더 ID 입력" : "파일 ID 입력"}
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
                  {renderStatusBadge(serviceStates.calendar, "calendar")}
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
      {syncResult && <p role={syncIssue ? "alert" : "status"} className={`text-sm font-medium ${syncIssue ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{syncResult}</p>}
      {analysisMessage && <p role={analysisFailed ? "alert" : "status"} className={`text-sm ${analysisFailed ? "text-destructive" : "text-muted-foreground"}`}>{analysisMessage}</p>}

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
