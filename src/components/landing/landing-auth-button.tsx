import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

type LandingAuthButtonProps = {
  isLoggedIn: boolean;
  variant?: "header" | "hero" | "cta";
  className?: string;
  label?: string;
};

export function LandingAuthButton({
  isLoggedIn,
  variant = "hero",
  className = "",
  label,
}: LandingAuthButtonProps) {
  if (isLoggedIn) {
    const text = label ?? "etc. 열기 →";
    if (variant === "header") {
      return (
        <Link
          href="/"
          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-xs font-medium text-white transition-opacity hover:opacity-85 ${className}`}
        >
          <span>etc. 열기</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      );
    }

    return (
      <Link
        href="/"
        className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink px-7 text-sm font-medium text-white transition-opacity hover:opacity-85 sm:text-base ${className}`}
      >
        <span>{text}</span>
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    );
  }

  // Not logged in: wrap existing GoogleSignInButton without duplicating OAuth logic
  if (variant === "header") {
    return (
      <GoogleSignInButton
        label={label ?? "Google로 시작하기"}
        pendingLabel="로그인 이동 중…"
        className={`inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-xs font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50 ${className}`}
      />
    );
  }

  if (variant === "cta") {
    return (
      <GoogleSignInButton
        label={label ?? "Google로 etc. 시작하기"}
        pendingLabel="Google 로그인으로 이동 중…"
        className={`inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-ink px-8 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-85 disabled:opacity-50 sm:text-base ${className}`}
      />
    );
  }

  return (
    <GoogleSignInButton
      label={label ?? "Google로 시작하기"}
      pendingLabel="Google 로그인으로 이동 중…"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink px-7 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-85 disabled:opacity-50 sm:text-base ${className}`}
    />
  );
}
