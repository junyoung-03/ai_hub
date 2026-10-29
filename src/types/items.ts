import type { AnalysisEvidence, DateObservation, ItemAnalysis } from "@/types/analysis";
import type { Tables } from "@/types/database";
import type { effectiveClassification } from "@/lib/items/presentation";

/** Phase 6B read contract, used by the existing GET Detail query. */
export type Item = {
  id: Tables<"items">["id"];
  title: Tables<"items">["title"];
  source: Tables<"items">["source"];
  format: Tables<"items">["format"];
  processingStatus: Tables<"items">["processing_status"];
  createdAt: string;
  updatedAt: string;
  contentText: string | null;
  sourceCreatedAt: string | null;
};

/** A null field means no override; an empty tags array is an explicit override. */
export type Classification = {
  primaryTopic: Tables<"classifications">["user_primary_topic"];
  documentType: Tables<"classifications">["user_document_type"];
  tags: Tables<"classifications">["user_tags"];
};
export type AIClassification = Omit<Classification, "tags"> & {
  tags: Tables<"classifications">["ai_tags"];
};
export type UserClassification = Classification;
export type EffectiveClassification = ReturnType<typeof effectiveClassification>;

/** Persisted Action values, never reconstructed from AI candidates or event dates. */
export type Action = {
  id: Tables<"actions">["id"];
  title: Tables<"actions">["title"];
  type: Tables<"actions">["action_type"];
  status: Tables<"actions">["status"];
  deadlineStatus: Tables<"actions">["deadline_status"];
  deadlineDate: Tables<"actions">["deadline_date"];
  deadlineAt: Tables<"actions">["deadline_at"];
  deadlineSourceId: Tables<"actions">["deadline_source_id"];
  requirements: Tables<"actions">["requirements"];
  conditions: Tables<"actions">["conditions"];
  startDate: Tables<"actions">["start_date"];
  startAt: Tables<"actions">["start_at"];
  completedAt: Tables<"actions">["completed_at"];
};

/** Whitelisted locator keys only; excludes internal analysisKey and arbitrary JSON. */
export type EvidenceLocator = Partial<AnalysisEvidence["locator"]> & {
  schemaVersion?: ItemAnalysis["schemaVersion"];
  evidence?: AnalysisEvidence[];
  startObservation?: DateObservation;
  deadlineObservation?: DateObservation;
};
export type ActionSource = {
  id: Tables<"action_sources">["id"];
  actionId: Tables<"action_sources">["action_id"];
  itemId: Tables<"action_sources">["item_id"];
  text: Tables<"action_sources">["evidence_text"];
  locator: EvidenceLocator;
  isCurrent: Tables<"action_sources">["is_current"];
  observedAt: Tables<"action_sources">["observed_at"];
  observedDeadlineDate: Tables<"action_sources">["observed_deadline_date"];
  observedDeadlineAt: Tables<"action_sources">["observed_deadline_at"];
};
export type Evidence = ActionSource;

/** Narrows the shared observation type to the existing v0.2 event validation rules. */
export type EventObservation = {
  rawText: string;
  evidence: AnalysisEvidence;
} & (
  | { status: "confirmed"; date: string; datetime: string | null }
  | { status: "needs_review"; date: null; datetime: null }
);

/** Safe summary of the stored artifact, not the raw metadata or AI candidate result. */
export type AIAnalysis = {
  schemaVersion: ItemAnalysis["schemaVersion"];
  analyzedAt: string;
};

export type ItemDetailResponse = {
  item: Item;
  calendar: import("@/types/calendar").CalendarDetail | null;
  upload: import("@/types/uploads").UploadDetail | null;
  gmail: { from: string; to: string; cc: string; bcc: string; dateHeader: string } | null;
  /** Compatibility alias of effectiveClassification. */
  classification: EffectiveClassification;
  aiClassification: AIClassification | null;
  userClassification: UserClassification | null;
  effectiveClassification: EffectiveClassification;
  actions: Action[];
  /** Flat ActionSource list, joined to actions by actionId; includes source history. */
  evidence: Evidence[];
  eventObservations: EventObservation[];
  aiAnalysis: AIAnalysis | null;
  processing: import("@/lib/items/processing").ProcessingSummary;
  original: { url: string | null; previewType: "google" | "upload" | "text" };
};

/** Calendar projection: no classifications, Action histories or raw analysis metadata. */
export type ItemScheduleDetail = {
  item: Pick<Item, "id" | "title" | "source" | "contentText">;
  calendar: ItemDetailResponse["calendar"];
  eventObservations: EventObservation[];
};
export type ItemSchedulePage = { items: ItemScheduleDetail[]; nextCursor: string | null };
