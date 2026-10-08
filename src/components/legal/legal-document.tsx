import Link from "next/link";
import type { ReactNode } from "react";

export function LegalDocument({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f6f5f2] text-[#1c1b19]">
      <div className="mx-auto w-full max-w-[880px] px-5 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] py-6">
          <span className="text-sm font-semibold">AI 통합 정보 허브</span>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">홈으로</Link>
        </header>
        <main className="py-10 sm:py-14">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-base leading-7 text-[#6f6b64]">{subtitle}</p>
          <p className="mt-2 text-sm leading-6 text-[#6f6b64]">시행일: 2026년 10월 8일</p>
          <article aria-label={title} className="mt-10 space-y-9 text-base leading-8 [overflow-wrap:anywhere] [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-8 [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:underline [&_a]:underline-offset-4">
            {children}
          </article>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e3dc] py-6 text-sm leading-6 text-[#6f6b64]">
          <p>AI 통합 정보 허브 · 시행일 2026년 10월 8일</p>
          <nav aria-label="법적 안내" className="flex flex-wrap gap-4">
            <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">개인정보처리방침</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4">서비스 이용약관</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
