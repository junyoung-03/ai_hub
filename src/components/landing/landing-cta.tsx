import { LandingAuthButton } from "./landing-auth-button";

type LandingCtaProps = {
  isLoggedIn: boolean;
};

export function LandingCta({ isLoggedIn }: LandingCtaProps) {
  return (
    <section className="border-t border-line bg-surface px-4 py-20 sm:px-6 sm:py-28 md:px-8">
      <div className="mx-auto max-w-4xl rounded-3xl border border-line bg-canvas p-8 text-center sm:p-14 shadow-sm">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          START WITH AI HUB
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-4xl sm:leading-tight">
          메일을 찾는 대신,<br />
          해야 할 일을 바로 확인하세요.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          수많은 공지와 문서 속에서 방황하지 마세요. 구글 계정으로 10초 만에 시작하여 마감일과 핵심 일정들을 한곳에서 단정하게 관리하세요.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3">
          <LandingAuthButton
            isLoggedIn={isLoggedIn}
            variant="cta"
            label={isLoggedIn ? "AI Hub 열기 →" : "Google로 AI Hub 시작하기"}
          />
          <p className="text-xs text-muted-foreground">
            기본 Google 계정 정보로 로그인하며, 메일·문서 연동은 로그인 후 선택할 수 있습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
