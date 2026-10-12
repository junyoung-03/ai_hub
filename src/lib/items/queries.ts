import "server-only";
import { calendarDetail } from "@/lib/google/calendar-contract";
import { uploadDetail } from "@/lib/uploads/contract";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { encodeCursor, filterLiteral, isItemId, type ItemQuery } from "@/lib/items/filters";
import { effectiveClassification, safeOriginalUrl, safeEvidenceLocator } from "@/lib/items/presentation";
import { validateAnalysis } from "@/lib/gemini/validation";
import { analysisDateContext, type AnalysisDateContext } from "@/lib/gemini/date-context";
import type { Json } from "@/types/database";
import type { Action, Evidence, EventObservation, ItemDetailResponse } from "@/types/items";

export class ItemReadError extends Error {
  constructor() { super("자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); }
}

const classificationColumns = "ai_primary_topic,user_primary_topic,ai_document_type,user_document_type,ai_tags,user_tags";
const itemColumns = "id,title,source,format,processing_status,created_at,source_created_at";

const relatedPageSize = 500;
async function readRelatedPages<T extends { id: string }>(fetchPage: (after?: string) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;
  for (;;) {
    const { data, error } = await fetchPage(after);
    if (error || !data) throw new ItemReadError();
    rows.push(...data);
    if (data.length < relatedPageSize) return rows;
    after = data.at(-1)!.id;
  }
}

export async function listItems(input: ItemQuery) {
  const user = await requireUser();
  const supabase = await createClient();
  const { filters, limit, position } = input;
  const filteredClassification = Boolean(filters.topic || filters.documentType);
  // FK is composite; the generated relationship can be an array despite UNIQUE(item_id).
  const select = filteredClassification
    ? `${itemColumns},classification:classifications!classifications_item_user_fk!inner(${classificationColumns})` as const
    : `${itemColumns},classification:classifications!classifications_item_user_fk(${classificationColumns})` as const;
  let query = supabase.from("items").select(select).eq("user_id", user.id);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.format) query = query.eq("format", filters.format);
  if (filters.processingStatus) query = query.eq("processing_status", filters.processingStatus);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  const effectiveFilters: string[] = [];
  if (filters.topic) {
    const value = filterLiteral(filters.topic);
    effectiveFilters.push(`or(user_primary_topic.eq.${value},and(user_primary_topic.is.null,ai_primary_topic.eq.${value}))`);
  }
  if (filters.documentType) {
    const value = filterLiteral(filters.documentType);
    effectiveFilters.push(`or(user_document_type.eq.${value},and(user_document_type.is.null,ai_document_type.eq.${value}))`);
  }
  if (effectiveFilters.length) query = query.or(`and(${effectiveFilters.join(",")})`, { referencedTable: "classification" });
  if (position) {
    const time = filterLiteral(position.createdAt);
    query = query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${position.id})`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error || !data) throw new ItemReadError();
  const items = data.slice(0, limit).map((row) => ({
    id: row.id, title: row.title, source: row.source, format: row.format,
    processingStatus: row.processing_status, createdAt: row.created_at, sourceCreatedAt: row.source_created_at,
    classification: effectiveClassification(Array.isArray(row.classification) ? row.classification[0] ?? null : row.classification),
  }));
  const last = items.at(-1);
  return { items, nextCursor: data.length > limit && last ? encodeCursor(last, input) : null };
}

/** Reuses the existing local validator only: no Gemini client, model config or writes. */
function storedAnalysis(metadata: Json, contentText: string | null, context?: AnalysisDateContext): Pick<ItemDetailResponse, "aiAnalysis" | "eventObservations"> {
  const empty = { aiAnalysis: null, eventObservations: [] };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || contentText === null) return empty;
  const artifact = metadata.aiAnalysis;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || artifact.schemaVersion !== "0.2"
    || typeof artifact.analyzedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(artifact.analyzedAt)
    || !Number.isFinite(Date.parse(artifact.analyzedAt))) return empty;
  try {
    const result = validateAnalysis(artifact.result, contentText, context);
    const eventObservations: EventObservation[] = result.eventObservations.flatMap((event): EventObservation[] => {
      if (!event.rawText || !event.evidence) return [];
      if (event.status === "confirmed" && event.date) return [{ status: "confirmed", date: event.date,
        datetime: event.datetime, rawText: event.rawText, evidence: event.evidence }];
      if (event.status === "needs_review") return [{ status: "needs_review", date: null,
        datetime: null, rawText: event.rawText, evidence: event.evidence }];
      return [];
    });
    return { aiAnalysis: { schemaVersion: "0.2", analyzedAt: artifact.analyzedAt }, eventObservations };
  } catch {
    // Missing, obsolete, malformed or unsupported-by-current-source artifacts are optional.
    return empty;
  }
}

export async function getItemDetail(itemId: string): Promise<ItemDetailResponse | null> {
  const user = await requireUser();
  if (!isItemId(itemId)) return null;
  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase.from("items")
    .select("id,title,source,format,processing_status,created_at,updated_at,content_text,original_url,source_created_at,metadata")
    .eq("user_id", user.id).eq("id", itemId).maybeSingle();
  if (itemError) throw new ItemReadError();
  if (!item) return null;
  const { data: classification, error: classificationError } = await supabase.from("classifications")
    .select(classificationColumns).eq("user_id", user.id).eq("item_id", itemId).maybeSingle();
  if (classificationError) throw new ItemReadError();
  const itemSources = await readRelatedPages((after) => {
    let query = supabase.from("action_sources").select("id,action_id")
      .eq("user_id", user.id).eq("item_id", itemId).order("id", { ascending: true }).limit(relatedPageSize);
    if (after) query = query.gt("id", after);
    return query;
  });
  const ids = [...new Set(itemSources.map((source) => source.action_id))];
  const actions: Action[] = [];
  const evidence: Evidence[] = [];
  // Chunk IN filters to keep request URLs bounded. Related rows use keyset reads
  // so the PostgREST default maximum cannot silently truncate evidence/history.
  for (let offset = 0; offset < ids.length; offset += 200) {
    const actionIds = ids.slice(offset, offset + 200);
    const { data: rows, error } = await supabase.from("actions")
      .select("id,title,action_type,status,deadline_status,deadline_date,deadline_at,deadline_source_id,requirements,conditions,start_date,start_at,completed_at")
      .eq("user_id", user.id).in("id", actionIds).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
    if (error || !rows) throw new ItemReadError();
    actions.push(...rows.map((row) => ({
      id: row.id, title: row.title, type: row.action_type, status: row.status,
      deadlineStatus: row.deadline_status, deadlineDate: row.deadline_date, deadlineAt: row.deadline_at, deadlineSourceId: row.deadline_source_id,
      requirements: row.requirements, conditions: row.conditions, startDate: row.start_date, startAt: row.start_at, completedAt: row.completed_at,
    })));
    // Read ALL sources for each Action, including other ITEMs and historical evidence.
    const sources = await readRelatedPages((after) => {
      let query = supabase.from("action_sources")
        .select("id,action_id,item_id,evidence_text,evidence_locator,is_current,observed_at,observed_deadline_date,observed_deadline_at")
        .eq("user_id", user.id).in("action_id", actionIds).order("id", { ascending: true }).limit(relatedPageSize);
      if (after) query = query.gt("id", after);
      return query;
    });
    evidence.push(...sources.map((row) => ({
      id: row.id, actionId: row.action_id, itemId: row.item_id, text: row.evidence_text,
      locator: safeEvidenceLocator(row.evidence_locator), isCurrent: row.is_current, observedAt: row.observed_at,
      observedDeadlineDate: row.observed_deadline_date, observedDeadlineAt: row.observed_deadline_at,
    })));
  }
  evidence.sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id));
  const google = ["gmail", "drive", "calendar"].includes(item.source);
  const metadata = typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata) ? item.metadata : {};
  const mailHeader = (name: string) => typeof metadata[name] === "string" ? metadata[name] as string : "";
  const effective = effectiveClassification(classification);
  return {
    item: { id: item.id, title: item.title, source: item.source, format: item.format, processingStatus: item.processing_status, createdAt: item.created_at, updatedAt: item.updated_at, contentText: item.content_text, sourceCreatedAt: item.source_created_at },
    calendar: item.source === "calendar" ? calendarDetail(item.metadata) : null,
    upload: item.source === "upload" ? uploadDetail(item.metadata) : null,
    gmail: item.source === "gmail" ? { from: mailHeader("from"), to: mailHeader("to"), cc: mailHeader("cc"), bcc: mailHeader("bcc"), dateHeader: mailHeader("date") } : null,
    classification: effective, effectiveClassification: effective,
    aiClassification: classification ? { primaryTopic: classification.ai_primary_topic,
      documentType: classification.ai_document_type, tags: classification.ai_tags } : null,
    userClassification: classification && effective.origin === "user" ? { primaryTopic: classification.user_primary_topic,
      documentType: classification.user_document_type, tags: classification.user_tags } : null,
    actions, evidence, ...storedAnalysis(item.metadata, item.content_text, analysisDateContext(item)),
    processing: { status: item.processing_status },
    original: { url: google ? safeOriginalUrl(item.original_url) : null, previewType: google ? "google" as const : item.source === "upload" ? "upload" as const : "text" as const },
  };
}

export type ItemList = Awaited<ReturnType<typeof listItems>>;
export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItemDetail>>>;
