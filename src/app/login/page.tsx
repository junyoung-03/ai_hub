import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  const message = error === "profile_setup"
    ? "사용자 프로필을 확인하지 못했습니다. 관리자에게 문의해 주세요."
    : error ? "로그인을 완료하지 못했습니다. 다시 시도해 주세요." : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-6">
      <section aria-labelledby="login-title" className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-3">
          <p className="text-xs font-medium tracking-widest text-muted-foreground">COLLECT · FIND · ACT</p>
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight">AI 통합 정보 허브</h1>
          <p className="text-sm text-muted-foreground">Google 계정으로 로그인해 시작하세요.</p>
        </div>
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        <GoogleSignInButton />
        <p className="text-xs leading-relaxed text-muted-foreground">
          로그인에는 기본 계정 정보만 사용합니다. Gmail, Drive, Calendar 연결은 별도 기능입니다.
        </p>
      </section>
    </main>
  );
}
