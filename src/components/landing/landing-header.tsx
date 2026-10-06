import Link from "next/link";
import { LandingAuthButton } from "./landing-auth-button";

type LandingHeaderProps = {
  isLoggedIn: boolean;
};

export function LandingHeader({ isLoggedIn }: LandingHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 md:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="AI Hub 홈">
            <span className="grid size-8 place-items-center rounded-xl bg-ink text-xs font-semibold tracking-[0.08em] text-white">
              H
            </span>
            <span className="text-[15px] font-semibold tracking-[0.12em] text-ink">HUB</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">AI 통합 정보 허브</span>
          </Link>

          <nav aria-label="랜딩페이지 주요 메뉴" className="hidden items-center gap-6 text-sm md:flex">
            <a href="#overview" className="text-muted-foreground transition-colors hover:text-ink">
              서비스 소개
            </a>
            <a href="#pillars" className="text-muted-foreground transition-colors hover:text-ink">
              3대 핵심 축
            </a>
            <a href="#demo" className="text-muted-foreground transition-colors hover:text-ink">
              AI 분석 데모
            </a>
            <a href="#bento" className="text-muted-foreground transition-colors hover:text-ink">
              주요 기능
            </a>
            <a href="#security" className="text-muted-foreground transition-colors hover:text-ink">
              보안·격리
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <LandingAuthButton isLoggedIn={isLoggedIn} variant="header" />
        </div>
      </div>
    </header>
  );
}
