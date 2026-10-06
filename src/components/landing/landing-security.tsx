import { Lock, ShieldCheck, Database, KeyRound, EyeOff } from "lucide-react";

export function LandingSecurity() {
  const points = [
    {
      icon: Lock,
      title: "사용자별 철저한 데이터 격리",
      description: "내 계정의 모든 자료는 나에게만 보입니다. 데이터베이스 수준에서 엄격한 소유권 격리를 적용해 타 사용자의 조회를 원천 차단합니다.",
    },
    {
      icon: Database,
      title: "Google 원본 데이터 불변 보존",
      description: "Gmail, Google Drive, Calendar의 원본은 Google 서버에 안전하게 유지됩니다. AI Hub의 분석 데이터를 삭제하더라도 Google 원본은 절대 훼손되지 않습니다.",
    },
    {
      icon: KeyRound,
      title: "언제든 자유로운 연결 해제",
      description: "설정에서 언제든지 Google 연결을 해제할 수 있습니다. 연결을 해제하더라도 이미 정리된 내 자료와 할 일 목록은 안전하게 보존됩니다.",
    },
    {
      icon: EyeOff,
      title: "업로드 원본 비공개 격리 저장",
      description: "직접 등록한 PDF와 이미지 파일은 외부 접근이 차단된 비공개 개인 전용 스토리지에 암호화 보관되며, 본인 인증 시에만 제한적으로 열람 가능합니다.",
    },
    {
      icon: ShieldCheck,
      title: "원문 근거(Evidence) 기반 신뢰성",
      description: "AI가 날짜나 요구사항을 임의로 지어내지 않습니다. 모든 분석 결과는 원문 속 증거 구절을 함께 확인한 후에만 확정됩니다.",
    },
  ];

  return (
    <section id="security" className="border-t border-line bg-canvas px-4 py-16 sm:px-6 sm:py-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            SECURITY & PRIVACY
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            내 자료는 내 계정에서만 보입니다
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            개인 업무 및 일상 문서의 민감성을 깊이 이해하고 설계했습니다. 안심하고 사용할 수 있는 5가지 원칙을 약속합니다.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((point) => {
            const Icon = point.icon;
            return (
              <div
                key={point.title}
                className="rounded-2xl border border-line bg-surface p-6 shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-canvas border border-line text-ink">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-ink">{point.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {point.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
