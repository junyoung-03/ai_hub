"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EffectiveClassification } from "@/types/items";
import { documentLabels } from "@/lib/items/presentation";
export function ClassificationEditor({ itemId, value }: { itemId: string; value: EffectiveClassification }) {
  const router = useRouter(), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  const [topic, setTopic] = useState(value.primaryTopic ?? ""), [type, setType] = useState<string>(value.documentType ?? ""), [tags, setTags] = useState(value.tags.join(", "));
  async function save() {
    const parsedTags = [...new Set(tags.split(",").map(t => t.trim()).filter(Boolean))];
    const patch: Record<string, unknown> = {};
    if (topic.trim() !== (value.primaryTopic ?? "")) patch.primaryTopic = topic.trim();
    if (type !== (value.documentType ?? "") && type) patch.documentType = type;
    if (JSON.stringify(parsedTags) !== JSON.stringify(value.tags)) patch.tags = parsedTags;
    if (!Object.keys(patch).length) { setMessage("변경된 분류가 없습니다."); return; }
    setBusy(true); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/v1/items/${itemId}/classification`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), cache: "no-store" });
      if (!response.ok) throw new Error(); setEditing(false); setMessage("사용자 분류가 저장되었습니다."); router.refresh();
    } catch { setError(true); setMessage("분류를 저장하지 못했습니다. 입력을 확인하고 다시 시도해 주세요."); } finally { setBusy(false); }
  }
  return <div className="space-y-3">{!editing ? <button className="btn-secondary" onClick={() => { setTopic(value.primaryTopic ?? ""); setType(value.documentType ?? ""); setTags(value.tags.join(", ")); setEditing(true); setMessage(""); }}>분류 수정</button> : <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
    <label className="block text-sm">주제<input className="field" value={topic} maxLength={100} required disabled={busy} onChange={e => setTopic(e.target.value)}/></label>
    <label className="block text-sm">문서 유형<select className="field" value={type} disabled={busy} onChange={e => setType(e.target.value)}><option value="">선택하지 않음</option>{Object.entries(documentLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <label className="block text-sm">태그 · 쉼표로 구분<input className="field" value={tags} disabled={busy} onChange={e => setTags(e.target.value)}/></label>
    <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? "저장 중…" : "분류 저장"}</button><button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>취소</button></div>
  </form>}{message && <p className="text-sm" role={error ? "alert" : "status"}>{message}</p>}</div>;
}
export function ActionStateButton({ actionId, status }: { actionId: string; status: string }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function change() {
    setBusy(true); setError(false);
    try {
      const response = await fetch(`/api/v1/actions/${actionId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: status === "completed" ? "open" : "completed" }), cache: "no-store" });
      if (!response.ok) throw new Error(); window.dispatchEvent(new Event("ai-hub:actions-changed")); router.refresh();
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="space-y-2"><button className={`inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium hover:bg-canvas disabled:opacity-50 ${status === "completed" ? "text-green" : "text-muted-foreground hover:text-ink"}`} disabled={busy} onClick={() => void change()}>{busy ? "저장 중…" : status === "completed" ? "미완료로 복원" : "완료 처리"}</button>{error && <p role="alert" className="text-sm text-destructive">상태를 저장하지 못했습니다. 다시 시도해 주세요.</p>}</div>;
}
