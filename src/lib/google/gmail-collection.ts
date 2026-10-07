import "server-only";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleConnectionSummary } from "@/lib/google/connections";
import { createGmailClient, GmailCollectionError, INITIAL_GMAIL_LIMIT, INITIAL_GMAIL_QUERY } from "@/lib/google/gmail-client";
import { mapGmailMessage, record, type GmailItem } from "@/lib/google/gmail-message";
import type { Json } from "@/types/database";
import { analysisCurrent, analysisEligible } from "@/lib/items/analysis-policy";

type Admin = ReturnType<typeof createAdminClient>;
const active = new Set<string>();

async function ensureConnected(admin: Admin, userId: string, connectionId: string) {
  const { data, error } = await admin.from("connections").select("id,sync_state,updated_at")
    .eq("id", connectionId).eq("user_id", userId).eq("provider", "google").eq("status", "connected").maybeSingle();
  if (error) throw new GmailCollectionError("STORAGE_FAILED");
  if (!data) throw new GmailCollectionError("CONNECTION_REQUIRED");
  return data;
}

export async function saveGmailItem(admin: Admin, userId: string, connectionId: string, item: GmailItem): Promise<"created" | "updated" | "skipped"> {
  const fields = {
    title: item.title, content_text: item.contentText, source_created_at: item.sourceCreatedAt,
    content_hash: item.contentHash, metadata: item.metadata,
    original_url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.externalId)}`,
  };
  // The existing partial expression unique index cannot be named in a PostgREST upsert.
  // Reselect on 23505 and optimistic UPDATE handle racing collectors without duplicates.
  for (let attempt = 0; attempt < 3; attempt++) {
    await ensureConnected(admin, userId, connectionId);
    const query = admin.from("items").select("id,content_hash,metadata,updated_at")
      .eq("user_id", userId).eq("connection_id", connectionId).eq("source", "gmail").eq("external_id", item.externalId);
    const { data: existing, error } = await query.maybeSingle();
    if (error) throw new GmailCollectionError("STORAGE_FAILED");
    if (existing) {
      if (existing.content_hash === item.contentHash) return "skipped";
      const { data, error: updateError } = await admin.from("items")
        .update({ ...fields, metadata: { ...record(existing.metadata), ...item.metadata } as Json })
        .eq("id", existing.id).eq("user_id", userId).eq("connection_id", connectionId)
        .eq("source", "gmail").eq("external_id", item.externalId).eq("updated_at", existing.updated_at).select("id").maybeSingle();
      if (updateError) throw new GmailCollectionError("STORAGE_FAILED");
      if (data) return "updated";
      continue;
    }
    const { error: insertError } = await admin.from("items").insert({
      ...fields, user_id: userId, connection_id: connectionId, source: "gmail", format: "email",
      external_id: item.externalId, external_container_id: null, processing_status: "queued",
    });
    if (!insertError) return "created";
    if (insertError.code !== "23505") throw new GmailCollectionError("STORAGE_FAILED");
  }
  throw new GmailCollectionError("STORAGE_FAILED");
}

async function storeBaseline(admin: Admin, userId: string, connectionId: string, historyId: string, capped: boolean, counts?: Record<string, number>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ensureConnected(admin, userId, connectionId);
    const state = record(current.sync_state), gmail = record(state.gmail);
    const previous = typeof gmail.history_id === "string" && /^\d{1,20}$/.test(gmail.history_id) ? gmail.history_id : "0";
    const now = new Date().toISOString();
    const { data, error } = await admin.from("connections").update({ last_synced_at: now, sync_state: {
      ...state, gmail: { ...gmail, history_id: BigInt(previous) > BigInt(historyId) ? previous : historyId,
        last_synced_at: now,
        last_result: counts ? {
          collected_count: counts.collected_count,
          created_count: counts.created_count,
          updated_count: counts.updated_count,
          skipped_count: counts.skipped_count,
          failed_count: counts.failed_count,
        } : (gmail.last_result ?? null),
        last_error: null,
        initial_collection: { completed_at: now, history_id: historyId, query: INITIAL_GMAIL_QUERY, max_messages: INITIAL_GMAIL_LIMIT, capped } },
    } as Json }).eq("id", connectionId).eq("user_id", userId).eq("provider", "google").eq("status", "connected")
      .eq("updated_at", current.updated_at).select("id").maybeSingle();
    if (error) throw new GmailCollectionError("STORAGE_FAILED");
    if (data) return;
  }
  throw new GmailCollectionError("STORAGE_FAILED");
}

export async function collectInitialGmail() {
  const user = await requireUser();
  const connection = await getGoogleConnectionSummary(user.id);
  if (!connection || connection.status !== "connected") throw new GmailCollectionError("CONNECTION_REQUIRED");
  // Check ownership through the authenticated RLS client before using the privileged writer.
  const cookieClient = await createClient();
  const { data: owned, error } = await cookieClient.from("connections").select("id").eq("id", connection.id)
    .eq("user_id", user.id).eq("provider", "google").eq("status", "connected").maybeSingle();
  if (error) throw new GmailCollectionError("STORAGE_FAILED");
  if (!owned) throw new GmailCollectionError("CONNECTION_REQUIRED");
  const key = `${user.id}:${connection.id}`;
  if (active.has(key)) throw new GmailCollectionError("SYNC_IN_PROGRESS");
  active.add(key);
  try {
    const gmail = await createGmailClient(user.id, connection.id), admin = createAdminClient();
    const historyId = await gmail.profile(); // Capture BEFORE enumeration, not after it.
    const { ids, capped } = await gmail.list();
    const counts = { collected_count: 0, created_count: 0, updated_count: 0, skipped_count: 0, failed_count: 0 };
    const collectedIds: string[] = [];
    // Bound parallel Google requests and DB work; individual failures do not discard successes.
    for (let offset = 0; offset < ids.length; offset += 4) {
      await ensureConnected(admin, user.id, connection.id);
      const results = await Promise.allSettled(ids.slice(offset, offset + 4).map(async (id) => {
        const raw = await gmail.message(id);
        const mapped = mapGmailMessage(raw, id);
        const outcome = await saveGmailItem(admin, user.id, connection.id, mapped);
        collectedIds.push(id); return outcome;
      }));
      for (const result of results) {
        if (result.status === "fulfilled") {
          counts.collected_count++;
          counts[`${result.value}_count`]++;
        } else {
          if (result.reason instanceof GmailCollectionError && ["REFRESH_FAILED", "CONNECTION_REQUIRED"].includes(result.reason.code)) throw result.reason;
          counts.failed_count++;
        }
      }
    }
    const complete = counts.failed_count === 0;
    if (complete) await storeBaseline(admin, user.id, connection.id, historyId, capped, counts);
    // Candidate discovery is after collection commit and cannot turn collection success into failure.
    let analysisItemIds: string[] = [], analysisDiscoveryFailed = false;
    try {
      if (collectedIds.length) {
        const { data: rows, error: candidateError } = await cookieClient.from("items").select("id,source,format,content_text,metadata")
          .eq("user_id", user.id).eq("connection_id", connection.id).eq("source", "gmail").in("external_id", collectedIds).limit(INITIAL_GMAIL_LIMIT);
        if (candidateError || !rows) throw new Error();
        analysisItemIds = rows.filter(row => analysisEligible(row) && !analysisCurrent(row, process.env.GEMINI_MODEL ?? "")).map(row => row.id);
      }
    } catch { analysisDiscoveryFailed = true; }
    return { ...counts, complete, capped, query: INITIAL_GMAIL_QUERY, max_messages: INITIAL_GMAIL_LIMIT, analysisItemIds, analysisDiscoveryFailed };
  } finally { active.delete(key); }
}
