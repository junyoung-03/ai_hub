import { AppShell } from "@/components/shell/app-shell";
import { GoogleConnectionPanel } from "@/components/connections/google-connection-panel";
import { getGoogleConnectionSummary, getGoogleServicesSyncSummary } from "@/lib/google/connections";
import { requirePageUser } from "@/lib/supabase/auth";
import { PageHeading } from "@/components/shell/page-heading";

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
    <AppShell title="설정" hideTitle workspace>
      <PageHeading title="설정" description="계정과 연결된 서비스의 상태를 확인하세요."/>
      <div className="settings-content mx-auto max-w-[1120px] space-y-7">
        <section aria-label="내 계정" className="workspace-card flex items-center gap-4 p-6"><span className="grid size-12 shrink-0 place-items-center rounded-full bg-slate-900 text-lg font-semibold text-white">{(user.email?.[0] ?? "A").toUpperCase()}</span><div className="min-w-0"><h2 className="font-semibold text-slate-900">내 계정</h2><p className="mt-1 break-all text-sm text-slate-500">{user.email}</p></div></section>
        <GoogleConnectionPanel connection={connection} syncSummary={syncSummary} notice={notice} />
      </div>
    </AppShell>
  );
}
