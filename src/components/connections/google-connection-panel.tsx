"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Connection = {
  status: "connected" | "disconnected" | "error";
  accountEmail: string | null;
  lastSyncedAt: string | null;
} | null;

export function GoogleConnectionPanel({ connection, notice }: { connection: Connection; notice: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<"connect" | "disconnect" | "sync" | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [syncResult, setSyncResult] = useState<string | null>(null);

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
    } catch { setMessage("메일 수집을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setPending(null); }
  }

  async function connect() {
    setPending("connect");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/connections/google/authorize", {
        method: "POST",
        headers: { Accept: "application/json" },
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
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Google 메일</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Gmail 읽기 전용 연결입니다. 서비스 로그인 계정과 다른 Google 계정을 연결할 수 있습니다.
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">연결 상태</dt>
        <dd>{connected ? "연결됨" : connection?.status === "error" ? "연결 오류" : "연결되지 않음"}</dd>
        {connection?.accountEmail && <><dt className="text-muted-foreground">연결된 이메일</dt><dd>{connection.accountEmail}</dd></>}
        {connection?.lastSyncedAt && <><dt className="text-muted-foreground">마지막 동기화</dt><dd>{new Date(connection.lastSyncedAt).toLocaleString("ko-KR")}</dd></>}
      </dl>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={connect} disabled={pending !== null} className="min-h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
          {pending === "connect" ? "연결 준비 중…" : connected ? "Google 메일 재연결" : "Google 메일 연결"}
        </button>
        {connected && (
          <button type="button" onClick={sync} disabled={pending !== null} className="min-h-10 rounded-md border bg-background px-4 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
            {pending === "sync" ? "메일 수집 중…" : "Gmail 초기 수집"}
          </button>
        )}
        {connected && (
          <button type="button" onClick={disconnect} disabled={pending !== null} className="min-h-10 rounded-md border bg-background px-4 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
            {pending === "disconnect" ? "연결 해제 중…" : "연결 해제"}
          </button>
        )}
      </div>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {syncResult && <p role="status" className="text-sm">{syncResult}</p>}
      <p className="text-xs text-muted-foreground">최근 30일 받은편지함에서 최대 100건을 수집합니다. 첨부파일은 다운로드하지 않으며 AI 분석은 아직 실행하지 않습니다.</p>
    </div>
  );
}
