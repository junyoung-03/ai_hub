"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Mail, Folder, CalendarDays } from "lucide-react";
import { formatTimestamp } from "@/lib/items/presentation";
import { runBoundedAnalysis } from "@/lib/items/browser-analysis";

type Connection = {
  status: "connected" | "disconnected" | "error";
  accountEmail: string | null;
  lastSyncedAt: string | null;
  capabilities: { gmail: boolean; drive: boolean; calendar: boolean };
} | null;

export function GoogleConnectionPanel({ connection, notice }: { connection: Connection; notice: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [driveTarget, setDriveTarget] = useState("");
  const [driveMode, setDriveMode] = useState("folder");
  async function collect(service: "drive" | "calendar") {
    setPending(service + "-collect"); setMessage(null); setSyncResult(null);
    try {
      const body = service === "calendar" ? {} : driveMode === "folder" ? { mode: "folder", folderId: driveTarget.trim() } : { mode: "files", fileIds: driveTarget.split(/[\s,]+/).filter(Boolean) };
      const response = await fetch(`/api/v1/connections/google/${service}/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const payload = await response.json() as { created: number; updated: number; reused: number; failed: number; unprocessed: number; complete: boolean; capped: boolean; analysisItemIds?: string[]; analysisDiscoveryFailed?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "수집을 완료하지 못했습니다.");
      setSyncResult(`${service === "drive" ? "Drive" : "Calendar"}: 신규 ${payload.created} · 갱신 ${payload.updated} · 기존 ${payload.reused} · 실패 ${payload.failed} · 미처리 ${payload.unprocessed}${!payload.complete || payload.capped ? " · 일부 수집 (대상과 제한 확인 필요)" : " · 수집 완료"}`); router.refresh();
      if (service === "drive") {
        if (payload.analysisDiscoveryFailed) setMessage("수집 자료는 저장되었습니다. 상세에서 AI 분석을 재시도하세요.");
        else await runBoundedAnalysis(payload.analysisItemIds ?? [], setMessage);
        router.refresh();
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "수집을 완료하지 못했습니다."); } finally { setPending(null); }
  }

  async function sync() {
    setPending("sync"); setMessage(null); setSyncResult(null);
    try {
      const response = await fetch("/api/v1/connections/google/sync", { method: "POST", headers: { Accept: "application/json" }, cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== "object" || payload === null) {
        const error = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
        setMessage(typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "메일 수집을 완료하지 못했습니다.");
        return;
      }
      const fields = ["collected_count", "created_count", "updated_count", "skipped_count", "failed_count"] as const;
      const values = fields.map((key) => key in payload ? payload[key as keyof typeof payload] : undefined);
      if (!values.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0)) throw new Error("Invalid collection result.");
      setSyncResult(`수집 ${values[0]}건 · 신규 ${values[1]}건 · 갱신 ${values[2]}건 · 기존 ${values[3]}건 · 실패 ${values[4]}건${"capped" in payload && payload.capped ? " (최대 100건 도달)" : ""}`);
      router.refresh();
      if ("analysisDiscoveryFailed" in payload && payload.analysisDiscoveryFailed) setMessage("메일은 저장되었습니다. 상세에서 AI 분석을 재시도하세요.");
      else await runBoundedAnalysis("analysisItemIds" in payload && Array.isArray(payload.analysisItemIds) ? payload.analysisItemIds.filter((id): id is string => typeof id === "string") : [], setMessage);
      router.refresh();
    } catch { setMessage("메일 수집을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setPending(null); }
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
          : "Google 메일 연결을 시작하지 못했습니다.";
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
      setMessage("Google 메일 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
          : "Google 메일 연결을 해제하지 못했습니다.";
        setMessage(errorMessage);
        setPending(null);
        return;
      }
      router.refresh();
      setPending(null);
    } catch {
      setPending(null);
      setMessage("Google 메일 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  const connected = connection?.status === "connected";
  return <div className="max-w-2xl space-y-6">
    <div><h2 className="text-base font-medium">연결된 서비스</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Gmail · Drive · Calendar의 읽기 권한과 수집을 관리합니다. 서비스 로그인과 다른 Google 계정도 연결할 수 있습니다.</p></div>
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <dl className="space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Google 계정</dt><dd className={connected ? "text-green" : "text-muted-foreground"}>{connected ? "연결됨" : connection?.status === "error" ? "연결 오류" : "연결되지 않음"}</dd></div>{connection?.accountEmail && <div><dt className="sr-only">연결된 이메일</dt><dd className="break-all">{connection.accountEmail}</dd></div>}{connection?.lastSyncedAt && <div className="meta"><dt className="inline">마지막 동기화 · </dt><dd className="inline">{formatTimestamp(connection.lastSyncedAt)}</dd></div>}</dl>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={()=>connect()} disabled={pending!==null} className="btn-primary">{pending === "connect" ? "연결 준비 중…" : connected ? "Google 메일 재연결" : "Google 메일 연결"}</button>{connected && <button type="button" onClick={disconnect} disabled={pending!==null} className="btn-secondary">{pending === "disconnect" ? "연결 해제 중…" : "연결 해제"}</button>}</div>
    </div>
    <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
      <section className="px-5 py-4"><div className="flex items-start gap-3.5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas"><Mail className="size-5 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Gmail</h3><p className="mt-1 text-sm text-muted-foreground">{connected && connection?.capabilities.gmail ? "읽기 권한 연결됨" : "읽기 권한 동의 필요"}</p><p className="meta mt-1">최근 30일 받은편지함 · 최대 100건</p></div>{connected && <button type="button" onClick={sync} disabled={pending!==null} className="btn-secondary">{pending === "sync" ? "수집 중…" : "Gmail 초기 수집"}</button>}</div></section>
      <section className="px-5 py-4"><div className="flex items-start gap-3.5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas"><Folder className="size-5 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Google Drive</h3><p className="mt-1 text-sm text-muted-foreground">{connected && connection?.capabilities.drive ? "읽기 권한 연결됨" : "읽기 권한 동의 필요"} · Google Docs</p></div></div>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-muted-foreground">수집 대상과 권한 관리</summary><div className="mt-4 space-y-3">{connected && <button type="button" onClick={()=>connect("drive_scope_upgrade")} disabled={pending!==null} className="btn-secondary">{pending === "drive_scope_upgrade" ? "동의 준비 중…" : "Drive/Docs 읽기 권한 추가"}</button>}<label className="block text-sm">수집 대상<select className="field mt-1" value={driveMode} onChange={e=>setDriveMode(e.target.value)}><option value="folder">폴더 ID</option><option value="files">파일 ID 목록 (최대 20개)</option></select></label><label className="block text-sm">{driveMode === "folder" ? "폴더 ID" : "파일 ID (쉼표나 줄바꿈으로 구분)"}<textarea className="field mt-1" rows={2} value={driveTarget} onChange={e=>setDriveTarget(e.target.value)} /></label><button className="btn-secondary" disabled={pending!==null || !connected || !connection?.capabilities.drive || !driveTarget.trim()} onClick={()=>void collect("drive")}>{pending==="drive-collect"?"Drive 수집 중…":"Drive 수집"}</button></div></details>
      </section>
      <section className="px-5 py-4"><div className="flex items-start gap-3.5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas"><CalendarDays className="size-5 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Google Calendar</h3><p className="mt-1 text-sm text-muted-foreground">{connected && connection?.capabilities.calendar ? "읽기 권한 연결됨" : "읽기 권한 동의 필요"}</p><p className="meta mt-1">기본 캘린더 · 일정 날짜와 행동 마감은 구분</p></div></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" disabled={pending!==null || !connected} onClick={()=>void connect("calendar_scope_upgrade")}>Calendar 읽기 권한 추가</button><button className="btn-secondary" disabled={pending!==null || !connected || !connection?.capabilities.calendar} onClick={()=>void collect("calendar")}>{pending==="calendar-collect"?"Calendar 수집 중…":"Calendar 수집"}</button></div></section>
    </div>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}{syncResult && <p role="status" className="text-sm">{syncResult}</p>}
    <p className="text-sm leading-6 text-muted-foreground">Gmail·Drive 수집 후 미분석·변경 자료의 본문을 Gemini로 보내 최대 3건씩 분석합니다. 민감한 자료는 수집하지 마세요. Calendar는 자동 분석에서 제외합니다.</p>
    <p className="text-sm leading-6 text-muted-foreground">연결 해제는 신규 수집을 중단하며 기존 자료·검색·할 일은 유지합니다.</p><Link href="/library" className="inline-block text-sm underline-offset-4 hover:underline">수집된 자료 확인 →</Link>
  </div>;
}