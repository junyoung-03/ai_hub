// Compile-only assertions run by npm run typecheck; no clients or external calls.
import type { ItemDetail } from "@/lib/items/queries";
import type { AnalysisEvidence, DateObservation } from "@/types/analysis";
import type { Json } from "@/types/database";
import type {
  Action, AIAnalysis, Classification, EventObservation, ItemDetailResponse,
} from "@/types/items";

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Equal<A, B> = Extends<A, B> extends true ? Extends<B, A> : false;
type NeedsReviewEvent = Extract<EventObservation, { status: "needs_review" }>;
// Freeze the pre-6B Action/Evidence shape rather than comparing the new contract to itself.
type LegacyDetail = Pick<ItemDetailResponse, "item" | "classification" | "gmail" | "processing" | "original"> & {
  actions: Pick<Action, "id" | "title" | "type" | "status" | "deadlineStatus" | "deadlineDate" | "deadlineAt" | "deadlineSourceId">[];
  evidence: { id: string; actionId: string; itemId: string; text: string; locator: Json; isCurrent: boolean; observedAt: string }[];
};

export type ContractChecks = [
  // Every legacy consumer can accept the additive response.
  Assert<Extends<ItemDetailResponse, LegacyDetail>>,
  // The actual query now promises the complete approved contract.
  Assert<Equal<ItemDetail, ItemDetailResponse>>,
  Assert<Equal<ItemDetailResponse["classification"], ItemDetailResponse["effectiveClassification"]>>,
  Assert<Equal<ItemDetailResponse["item"]["processingStatus"], ItemDetail["item"]["processingStatus"]>>,
  Assert<Equal<Action["status"], "open" | "completed">>,
  Assert<Equal<Action["deadlineStatus"], "confirmed" | "needs_review" | "none">>,
  Assert<Equal<Classification["tags"], string[] | null>>,
  Assert<Equal<AIAnalysis["schemaVersion"], "0.2" | "0.3">>,
  Assert<Extends<EventObservation, DateObservation>>,
  Assert<Equal<EventObservation["status"], "confirmed" | "needs_review">>,
  Assert<Equal<EventObservation["evidence"], AnalysisEvidence>>,
  Assert<Equal<NeedsReviewEvent["date"], null>>,
  Assert<Equal<NeedsReviewEvent["datetime"], null>>,
  Assert<Equal<Extract<EventObservation, { status: "none" }>, never>>,
  Assert<Equal<Extract<keyof ItemDetailResponse["item"], "metadata" | "userId" | "storagePath">, never>>,
  Assert<Equal<Extract<keyof AIAnalysis, "model" | "inputFingerprint" | "result">, never>>,
  Assert<Equal<Extract<keyof ItemDetailResponse["evidence"][number]["locator"], "analysisKey">, never>>,
];
