import { AppShell } from "@/components/shell/app-shell";
import { GoogleConnectionPanel } from "@/components/connections/google-connection-panel";
import { getGoogleConnectionSummary, getGoogleServicesSyncSummary } from "@/lib/google/connections";
import { requirePageUser } from "@/lib/supabase/auth";

const NOTICES: Record<string, string> = {
  denied: "Google 권한 동의가 취소되었습니다.",
  invalid_state: "Google 연결 요청을 확인할 수 없습니다. 다시 시작해 주세요.",
  oauth_failed: "Google 인증을 완료하지 못했습니다.",
  scope_error: "요청한 Gmail 읽기 권한을 확인하지 못했습니다.",
  profile_failed: "연결된 Gmail 계정을 확인하지 못했습니다.",
  storage_unavailable: "안전한 Token 저장소를 준비한 뒤 연결할 수 있습니다.",
  connected: "Google 메일 연결이 완료되었습니다.",
  drive_connected: "Google Drive/Docs 읽기 권한이 추가되었습니다. 파일 수집은 아직 실행하지 않습니다.",
  calendar_connected: "Google Calendar 읽기 권한이 추가되었습니다.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const [connection, syncSummary] = await Promise.all([
    getGoogleConnectionSummary(user.id),
    getGoogleServicesSyncSummary(user.id),
  ]);
  const value = (await searchParams).connection;
  const result = typeof value === "string" ? value : null;
  const notice = result && Object.hasOwn(NOTICES, result) ? NOTICES[result] : null;

  return (
    <AppShell title="설정 · 연결">
      <GoogleConnectionPanel connection={connection} syncSummary={syncSummary} notice={notice} />
    </AppShell>
  );
}
