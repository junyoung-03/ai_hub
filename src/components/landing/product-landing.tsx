import Link from "next/link";
import { ArrowRight, CalendarDays, Library, ListChecks, Settings, ShieldCheck } from "lucide-react";
import { LandingAuthButton } from "./landing-auth-button";
import { LandingProductPreview } from "./landing-product-preview";
import { workspaceSources } from "@/components/workspace/workspace-ui";

const navigation = [
  { href: "#today", label: "오늘" }, { href: "#library", label: "자료함" },
  { href: "#planner", label: "플래너" }, { href: "#settings", label: "설정" },
];
const features = [
  { id: "library", Icon: Library, label: "자료함", title: "흩어진 자료를 한곳에", text: "메일과 문서를 연결하고, PDF·이미지·메모를 추가하세요. 기억나는 제목이나 본문으로 찾고 원문과 분석 결과를 확인할 수 있어요.", detail: "자료 추가 · 검색 · 원문 확인" },
  { id: "planner", Icon: ListChecks, label: "플래너", title: "해야 할 일을 놓치지 않게", text: "할 일을 직접 추가하고 날짜와 시간을 정하세요. 수정과 완료 관리는 플래너에서, 오늘과 다가오는 할 일은 Home에서 함께 확인하세요.", detail: "할 일 추가 · 수정 · 완료 관리" },
  { id: "settings", Icon: Settings, label: "설정", title: "필요한 연결만 선택", text: "Gmail·Drive·Calendar 연결 상태를 한곳에서 확인하세요. 필요한 서비스를 선택하고 직접 동기화를 실행할 수 있어요.", detail: "Google 연결 · 동기화 · 상태 확인" },
];

export function ProductLanding({ isLoggedIn }: { isLoggedIn: boolean }) {
  return <div className="home-reference-shell relative isolate min-h-dvh overflow-x-clip text-slate-900 antialiased selection:bg-blue-100">
    <div className="home-background-ghost" aria-hidden="true"/>
    <div className="home-background-wash" aria-hidden="true"/>
    <a href="#landing-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">본문으로 이동</a>
    <header className="sticky top-0 z-30 border-b border-blue-100/70 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-12">
          <Link href="/" aria-label="etc. 홈" className="flex shrink-0 items-center gap-1.5 text-2xl font-bold tracking-tight"><span aria-hidden="true" className="text-3xl text-blue-600">✦</span>etc.</Link>
          <nav aria-label="랜딩 주요 메뉴" className="hidden items-center gap-2 md:flex">{navigation.map(({href,label},index) => <a key={href} href={href} className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${index === 0 ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"}`}>{label}</a>)}</nav>
        </div>
        <LandingAuthButton isLoggedIn={isLoggedIn} variant="header"/>
      </div>
    </header>
    <main id="landing-content" className="relative">
      <section className="px-5 pb-10 pt-14 sm:px-8 sm:pb-14 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold text-blue-600">메일부터 오늘의 할 일까지, etc.</p>
          <h1 className="mt-5 text-[36px] font-bold leading-[1.22] tracking-[-0.045em] text-slate-900 sm:text-[56px]">흩어진 자료와 해야 할 일,<br/><span className="text-blue-600">오늘 한눈에.</span></h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">메일·문서·파일을 모으고 필요한 정보를 찾아보세요.<br className="hidden sm:block"/>캘린더와 할 일 목록으로 다음 일정까지 함께 확인하세요.</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <LandingAuthButton isLoggedIn={isLoggedIn}/>
            <a href="#today" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-blue-100 bg-white/90 px-6 text-sm font-semibold text-slate-700 transition-colors hover:bg-blue-50">화면 살펴보기 <ArrowRight className="size-4" aria-hidden="true"/></a>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">Google 계정으로 시작하고, 서비스 연결은 로그인 후 선택하세요.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">{workspaceSources.map(({value,label,Icon}) => <span key={value} className="inline-flex items-center gap-1.5 rounded-full border border-blue-100/80 bg-white/80 px-3 py-1.5 text-xs text-slate-600"><Icon className="size-3.5 text-blue-500" aria-hidden="true"/>{label}</span>)}</div>
        </div>
      </section>
      <section id="today" aria-labelledby="today-preview-title" className="scroll-mt-24 px-4 sm:px-8">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-4 flex items-center justify-between gap-3 px-1"><h2 id="today-preview-title" className="flex items-center gap-2 text-sm font-semibold text-slate-700"><CalendarDays className="size-4 text-blue-600" aria-hidden="true"/>오늘을 확인하는 가장 간단한 화면</h2><span className="hidden text-xs text-slate-500 sm:block">검색 · 캘린더 · 오늘 할 일 · 다가오는 일정</span></div>
          <LandingProductPreview/>
        </div>
      </section>
      <section aria-labelledby="features-title" className="px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <p className="text-sm font-semibold text-blue-600">하나의 공간, 연결된 흐름</p>
          <h2 id="features-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-4xl">자료를 찾는 순간부터,<br className="sm:hidden"/> 할 일을 마칠 때까지.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">{features.map(({id,Icon,label,title,text,detail}) => <article id={id} key={id} className="scroll-mt-24 rounded-2xl border border-white bg-white/95 p-6 shadow-sm shadow-blue-100/20 sm:p-7"><div className="flex items-center gap-2 text-sm font-semibold text-blue-600"><Icon className="size-5" aria-hidden="true"/>{label}</div><h3 className="mt-5 text-xl font-bold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-500">{text}</p><p className="mt-6 border-t border-slate-100 pt-4 text-xs font-medium text-slate-600">{detail}</p></article>)}</div>
        </div>
      </section>
      <section aria-labelledby="how-title" className="border-y border-blue-100/70 bg-white/60 px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto grid max-w-[1240px] gap-8 lg:grid-cols-[.9fr_1.4fr] lg:gap-16">
          <div><p className="text-sm font-semibold text-blue-600">시작은 간단하게</p><h2 id="how-title" className="mt-3 text-2xl font-bold leading-snug tracking-tight sm:text-3xl">내 자료로 시작하는<br/>나만의 워크스페이스.</h2></div>
          <ol className="grid gap-6 sm:grid-cols-3">{[{title:"연결하거나 추가하세요",text:"필요한 Google 서비스를 연결하거나 가지고 있는 파일과 메모를 추가하세요."},{title:"찾고 근거를 확인하세요",text:"제목과 본문을 검색하고, 자료 상세에서 원문과 날짜의 근거를 확인하세요."},{title:"오늘과 다음 일을 확인하세요",text:"할 일은 플래너에서 관리하고 캘린더와 다가오는 일정에서 함께 살펴보세요."}].map(({title,text},index) => <li key={title}><span className="grid size-9 place-items-center rounded-xl border border-blue-100 bg-white text-sm font-semibold text-blue-600">0{index+1}</span><h3 className="mt-4 text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-slate-500">{text}</p></li>)}</ol>
        </div>
      </section>
      <section aria-labelledby="data-title" className="px-5 py-14 sm:px-8 sm:py-20"><div className="mx-auto max-w-[1240px]"><h2 id="data-title" className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="size-5 text-blue-600" aria-hidden="true"/>출처와 근거를 함께 확인하세요.</h2><div className="mt-6 grid gap-6 md:grid-cols-3">{[{title:"Google 원본은 그대로",text:"Gmail·Drive·Calendar의 원본은 Google에 유지합니다. 서비스의 자료 삭제가 Google 원본 삭제로 이어지지 않습니다."},{title:"연결은 내가 선택",text:"Google 로그인과 서비스 연결은 별개입니다. 연결을 해제하면 새 동기화를 멈추고 기존에 수집한 자료는 유지합니다."},{title:"분석 결과는 원문과 함께",text:"AI 분석에 콘텐츠가 제공자로 전송될 수 있습니다. 날짜와 요구사항의 근거를 확인하고 분류를 직접 수정할 수 있습니다."}].map(({title,text}) => <div key={title}><h3 className="text-sm font-semibold text-slate-700">{title}</h3><p className="mt-2 text-sm leading-7 text-slate-500">{text}</p></div>)}</div></div></section>
      <section className="px-5 pb-16 sm:px-8 sm:pb-24"><div className="mx-auto max-w-[1240px] rounded-3xl border border-white bg-white/90 px-6 py-12 text-center shadow-sm shadow-blue-100/20 sm:py-16"><p className="text-sm font-semibold text-blue-600">etc.</p><h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-4xl">오늘 필요한 정보와 할 일,<br/>한곳에서 시작하세요.</h2><div className="mt-7 flex justify-center"><LandingAuthButton isLoggedIn={isLoggedIn} variant="cta"/></div></div></section>
    </main>
    <footer className="relative z-10 border-t border-blue-100/70 bg-white/70 px-5 py-7 sm:px-8"><div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5"><p className="text-xs text-slate-500"><span className="mr-3 text-base font-bold text-slate-900"><span className="text-blue-600">✦</span> etc.</span>COLLECT · FIND · ACT</p><nav aria-label="법적 안내" className="flex flex-wrap gap-5 text-xs text-slate-500"><Link href="/privacy" className="hover:text-blue-600">개인정보처리방침</Link><Link href="/terms" className="hover:text-blue-600">이용약관</Link><a href="mailto:an5194jung@gmail.com" className="hover:text-blue-600">문의</a></nav></div></footer>
  </div>;
}
