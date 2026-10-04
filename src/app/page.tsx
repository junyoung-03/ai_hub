import { AppShell } from "@/components/shell/app-shell";

export default function Page() {
  return (
    <AppShell title="Home">
      <p className="text-muted-foreground">AI 통합 정보 허브에 오신 것을 환영합니다.</p>
      <p className="mt-3 text-sm text-muted-foreground">
        정보 수집, 검색, Action 기능은 다음 개발 단계에서 연결됩니다.
      </p>
    </AppShell>
  );
}
