import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isItemId } from "./filters";
import { safeEvidenceLocator } from "./presentation";
import { ItemWriteError } from "./writes";
import type { Enums } from "@/types/database";
import type { SearchActionResult } from "@/types/search-ui";
export function parseActionQuery(params: URLSearchParams) {
  for (const k of params.keys()) if (!["type", "status", "deadlineStatus", "limit", "cursor"].includes(k) || params.getAll(k).length !== 1) throw new ItemWriteError("VALIDATION_ERROR");
  const status = params.get("status") ?? "open", type = params.get("type"), deadlineStatus = params.get("deadlineStatus"), limit = Number(params.get("limit") ?? 20);
  if (!["open", "completed"].includes(status) || type && !["required", "optional", "check"].includes(type)
    || deadlineStatus && !["confirmed", "needs_review", "none"].includes(deadlineStatus)
    || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new ItemWriteError("VALIDATION_ERROR");
  return { status: status as Enums<"action_status">, type: type as Enums<"action_type"> | null, deadlineStatus: deadlineStatus as Enums<"deadline_status"> | null, limit, cursor: params.get("cursor") };
}
function sign(body: string) {
  const key = process.env.SEARCH_CURSOR_SECRET?.trim(); if (!key || key.length < 32) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  return createHmac("sha256", key).update(body).digest();
}
export async function listActions(params: URLSearchParams) {
  const user = await requireUser(), input = parseActionQuery(params), client = await createClient();
  const context = JSON.stringify([user.id, input.status, input.type, input.deadlineStatus, input.limit]);
  let query = client.from("actions").select("id,title,action_type,status,deadline_status,deadline_date,deadline_at,requirements,conditions,completed_at,created_at")
    .eq("user_id", user.id).eq("status", input.status);
  if (input.type) query = query.eq("action_type", input.type);
  if (input.deadlineStatus) query = query.eq("deadline_status", input.deadlineStatus);
  if (input.cursor) {
    if (input.cursor.length > 2048) throw new ItemWriteError("VALIDATION_ERROR");
    const [body, signature, extra] = input.cursor.split("."); const expected = sign(body ?? ""), supplied = Buffer.from(signature ?? "", "base64url");
    if (extra || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw new ItemWriteError("VALIDATION_ERROR");
    let position: { context: string; createdAt: string; id: string };
    try { position = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw new ItemWriteError("VALIDATION_ERROR"); }
    if (position.context !== context || !isItemId(position.id) || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(position.createdAt) || !Number.isFinite(Date.parse(position.createdAt))) throw new ItemWriteError("VALIDATION_ERROR");
    query = query.or(`created_at.lt.${position.createdAt},and(created_at.eq.${position.createdAt},id.lt.${position.id})`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1);
  if (error || !data) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  const rows = data.slice(0, input.limit), results: SearchActionResult[] = [];
  if (rows.length) {
    const sources = []; let after: string | undefined;
    for (;;) {
      let q = client.from("action_sources").select("id,action_id,item_id,evidence_text,evidence_locator,item:items!action_sources_item_user_fk(id,title,source,format)")
        .eq("user_id", user.id).eq("is_current", true).in("action_id", rows.map(r => r.id)).order("id").limit(500);
      if (after) q = q.gt("id", after);
      const { data: page, error: sourceError } = await q;
      if (sourceError || !page) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
      sources.push(...page); if (page.length < 500) break; after = page.at(-1)!.id;
    }
    for (const row of rows) results.push({ kind: "action", actionId: row.id, title: row.title, type: row.action_type, status: row.status,
      deadlineStatus: row.deadline_status, deadlineDate: row.deadline_date, deadlineAt: row.deadline_at, requirements: row.requirements, conditions: row.conditions,
      sources: sources.filter(s => s.action_id === row.id).flatMap(s => {
        const item = Array.isArray(s.item) ? s.item[0] : s.item; if (!item) return [];
        const loc = safeEvidenceLocator(s.evidence_locator);
        return [{ itemId: item.id, title: item.title, source: item.source, format: item.format, text: s.evidence_text,
          detailUrl: `/items/${item.id}`, location: { field: loc.field ?? "content_text", startChar: loc.startChar ?? null, endChar: loc.endChar ?? null, page: loc.page ?? null, tabId: null, method: null, offsetUnit: "unicode_code_point" } }];
      }) });
  }
  const last = rows.at(-1); let nextCursor: string | null = null;
  if (last && data.length > input.limit) {
    const body = Buffer.from(JSON.stringify({ context, createdAt: new Date(last.created_at).toISOString(), id: last.id })).toString("base64url");
    nextCursor = `${body}.${sign(body).toString("base64url")}`;
  }
  return { results, nextCursor, limit: input.limit, status: input.status };
}
