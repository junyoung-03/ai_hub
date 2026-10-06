import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-surface px-4 py-12 sm:px-6 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-xs font-semibold tracking-[0.08em] text-white">
            H
          </span>
          <span className="text-sm font-semibold tracking-[0.12em] text-ink">HUB</span>
          <span className="text-xs text-muted-foreground">· AI 통합 정보 허브</span>
        </div>

        <nav aria-label="푸터 안내 링크" className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
          <a href="#overview" className="transition-colors hover:text-ink">
            서비스 소개
          </a>
          <a href="#pillars" className="transition-colors hover:text-ink">
            COLLECT · FIND · ACT
          </a>
          <a href="#security" className="transition-colors hover:text-ink">
            개인정보 및 보안
          </a>
          <Link href="/login" className="transition-colors hover:text-ink">
            로그인
          </Link>
        </nav>

        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} AI Hub. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
