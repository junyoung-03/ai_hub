"use client";

import { useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Navigation } from "./navigation";

const key = "ai-hub:sidebar-collapsed";
const changeEvent = "ai-hub:sidebar-changed";
let fallback = false;
function snapshot() {
  try { return window.localStorage.getItem(key) === "true"; } catch { return fallback; }
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) callback(); };
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(changeEvent, callback); window.removeEventListener("storage", storage); };
}

export function Sidebar({ demo }: { demo: boolean }) {
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => false);
  const label = collapsed ? "사이드바 펼치기" : "사이드바 접기";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  function toggle() {
    fallback = !collapsed;
    try { window.localStorage.setItem(key, String(!collapsed)); } catch { /* Keep the toggle usable when browser storage is unavailable. */ }
    window.dispatchEvent(new Event(changeEvent));
  }
  return <aside data-sidebar-collapsed={collapsed} className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r py-5 transition-[width] duration-200 motion-reduce:transition-none md:flex ${collapsed ? "w-16 px-2" : "w-48 px-3"} ${demo ? "border-slate-200/60 bg-white/75" : "border-line bg-surface"}`}>
    <div className={`mb-4 flex items-center ${collapsed ? "justify-center" : "justify-between pl-3"}`}>
      {!collapsed&&<span className="text-[11px] text-slate-400">메뉴</span>}
      <button type="button" onClick={toggle} aria-label={label} title={label} aria-expanded={!collapsed} aria-controls="desktop-sidebar-navigation" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-[#edf2fa] hover:text-[#5f7fae] focus-visible:outline-2 focus-visible:outline-[#7894bd]"><Icon className="size-4" aria-hidden="true"/></button>
    </div>
    <div id="desktop-sidebar-navigation"><Navigation collapsed={collapsed}/></div>
  </aside>;
}
