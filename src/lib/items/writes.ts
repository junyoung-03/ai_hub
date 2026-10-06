import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isItemId } from "@/lib/items/filters";
import { effectiveClassification } from "@/lib/items/presentation";
import type { Enums, Tables } from "@/types/database";

export class ItemWriteError extends Error {
  constructor(public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "STORAGE_UNAVAILABLE", public readonly status = 400) { super(code); }
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ItemWriteError("VALIDATION_ERROR");
  return v as Record<string, unknown>;
};
const documentTypes = ["notice", "application", "contract", "billing", "reservation", "certificate", "schedule", "general", "other"] as const;
export function parseClassification(value: unknown) {
  const v = object(value), keys = Object.keys(v);
  if (!keys.length || keys.some(k => !["primaryTopic", "documentType", "tags"].includes(k))) throw new ItemWriteError("VALIDATION_ERROR");
  const result: { primaryTopic?: string | null; documentType?: Enums<"document_type"> | null; tags?: string[] | null } = {};
  if ("primaryTopic" in v) {
    if (v.primaryTopic !== null && (typeof v.primaryTopic !== "string" || !v.primaryTopic.trim() || Array.from(v.primaryTopic).length > 100 || /[\x00-\x1f\x7f]/.test(v.primaryTopic))) throw new ItemWriteError("VALIDATION_ERROR");
    result.primaryTopic = v.primaryTopic === null ? null : (v.primaryTopic as string).trim().normalize("NFC");
  }
  if ("documentType" in v) {
    if (v.documentType !== null && !documentTypes.includes(v.documentType as Enums<"document_type">)) throw new ItemWriteError("VALIDATION_ERROR");
    result.documentType = v.documentType as Enums<"document_type"> | null;
  }
  if ("tags" in v) {
    if (v.tags !== null && (!Array.isArray(v.tags) || v.tags.length > 20 || v.tags.some(t => typeof t !== "string" || !t.trim() || Array.from(t).length > 50 || /[\x00-\x1f\x7f]/.test(t)))) throw new ItemWriteError("VALIDATION_ERROR");
    result.tags = v.tags === null ? null : [...new Set((v.tags as string[]).map(t => t.trim().normalize("NFC")))];
  }
  return result;
}
export function parseActionStatus(value: unknown): Enums<"action_status"> {
  const v = object(value);
  if (Object.keys(v).join(",") !== "status" || !["open", "completed"].includes(String(v.status))) throw new ItemWriteError("VALIDATION_ERROR");
  return v.status as Enums<"action_status">;
}
export function classificationResponse(row: Tables<"classifications">) {
  const effective = effectiveClassification(row);
  return { aiClassification: { primaryTopic: row.ai_primary_topic, documentType: row.ai_document_type, tags: row.ai_tags },
    userClassification: effective.origin === "user" ? { primaryTopic: row.user_primary_topic, documentType: row.user_document_type, tags: row.user_tags } : null,
    effectiveClassification: effective, editedByUser: effective.origin === "user", updatedAt: row.updated_at, userEditedAt: row.user_edited_at };
}
export async function updateClassification(itemId: string, value: unknown) {
  const user = await requireUser(); const patch = parseClassification(value);
  if (!isItemId(itemId)) throw new ItemWriteError("NOT_FOUND", 404);
  const client = await createClient();
  const { data: item, error } = await client.from("items").select("id").eq("id", itemId).eq("user_id", user.id).maybeSingle();
  if (error) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  if (!item) throw new ItemWriteError("NOT_FOUND", 404);
  const { data: previous, error: readError } = await client.from("classifications").select("*").eq("item_id", itemId).eq("user_id", user.id).maybeSingle();
  if (readError) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  const { error: writeError } = await client.rpc("set_classification_override", {
    p_item_id: itemId,
    p_primary_topic: ("primaryTopic" in patch ? patch.primaryTopic : previous?.user_primary_topic) ?? null,
    p_document_type: ("documentType" in patch ? patch.documentType : previous?.user_document_type) ?? null,
    p_tags: ("tags" in patch ? patch.tags : previous?.user_tags) ?? null,
  });
  if (writeError) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  const { data: saved, error: savedError } = await client.from("classifications").select("*").eq("item_id", itemId).eq("user_id", user.id).single();
  if (savedError || !saved) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  return classificationResponse(saved);
}
export async function updateActionStatus(actionId: string, value: unknown) {
  const user = await requireUser(); const status = parseActionStatus(value);
  if (!isItemId(actionId)) throw new ItemWriteError("NOT_FOUND", 404);
  const client = await createClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: action, error } = await client.from("actions").select("id,status,completed_at,updated_at").eq("id", actionId).eq("user_id", user.id).maybeSingle();
    if (error) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
    if (!action) throw new ItemWriteError("NOT_FOUND", 404);
    if (action.status === status) return { actionId, status, completed: status === "completed", completedAt: action.completed_at, updatedAt: action.updated_at };
    // Owner read through RLS occurs before the service writer. Only two fields are writable.
    const { data: saved, error: writeError } = await createAdminClient().from("actions")
      .update({ status, completed_at: status === "completed" ? new Date().toISOString() : null })
      .eq("id", actionId).eq("user_id", user.id).eq("updated_at", action.updated_at).eq("status", action.status)
      .select("status,completed_at,updated_at").maybeSingle();
    if (writeError) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
    if (saved) return { actionId, status: saved.status, completed: saved.status === "completed", completedAt: saved.completed_at, updatedAt: saved.updated_at };
  }
  throw new ItemWriteError("CONFLICT", 409);
}
