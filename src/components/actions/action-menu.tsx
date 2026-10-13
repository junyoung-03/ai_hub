"use client";
import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { AddTodoModal } from "@/components/home/add-todo-modal";
import type { SearchActionResult } from "@/types/search-ui";

export function ActionMenu({ action }: { action: SearchActionResult }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const confirmation = useRef<HTMLDialogElement>(null);
  const sourced = action.sources.length > 0;
  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/actions/${action.actionId}`, { method: "DELETE", headers: {"Content-Type": "application/json"}, body: "{}", cache: "no-store" });
      if (!response.ok) throw new Error();
      confirmation.current?.close(); window.dispatchEvent(new Event("ai-hub:actions-changed"));
    } catch { setError("삭제하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <>
    <details className="relative"><summary aria-label={`${action.title} 관리`} className="flex min-h-9 cursor-pointer list-none items-center rounded-lg px-2 hover:bg-slate-50"><MoreHorizontal className="size-4"/></summary>
      <div className="absolute right-0 z-10 min-w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        {sourced ? <p className="p-2 text-xs text-slate-500">자료에서 찾은 할 일의 수정·삭제는 정책 검토 중입니다. 완료·복원은 가능합니다.</p> : <>
          <button className="block w-full rounded-lg p-2 text-left text-sm hover:bg-slate-50" onClick={() => setEditing(true)}>수정</button>
          <button className="block w-full rounded-lg p-2 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => { setError(""); confirmation.current?.showModal(); }}>삭제</button>
        </>}
      </div>
    </details>
    {editing && <AddTodoModal isOpen onClose={() => setEditing(false)} initialDate={action.deadlineDate ?? ""} editingAction={action} onAdded={() => {}}/>}
    <dialog ref={confirmation} aria-labelledby={`delete-${action.actionId}`} onCancel={event => { if (busy) event.preventDefault(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-900/20">
      <h2 id={`delete-${action.actionId}`} className="font-semibold">이 할 일을 삭제하시겠습니까?</h2><p className="mt-2 break-words text-sm text-slate-500">{action.title}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-3"><button disabled={busy} onClick={() => confirmation.current?.close()} className="rounded-lg border px-3 py-2 text-sm">취소</button><button disabled={busy} onClick={() => void remove()} className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white">{busy ? "삭제 중…" : "삭제"}</button></div>
    </dialog>
  </>;
}
