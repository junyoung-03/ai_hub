import type { Database } from "@/types/database";
export type AnalysisEvidence = {
  text: string;
  locator: { kind: "text_span" | "page" | "email_section" | "calendar_field" | "metadata" | "unknown";
    page: number | null; section: string | null; startChar: number | null;
    endChar: number | null; field: string | null };
};
export type DateObservation = {
  status: "confirmed" | "needs_review" | "none"; date: string | null;
  datetime: string | null; rawText: string | null; evidence: AnalysisEvidence | null;
};
export type ActionCandidate = {
  title: string; actionType: Database["public"]["Enums"]["action_type"];
  requirements: string[]; conditions: string[]; startObservation: DateObservation;
  deadlineObservation: DateObservation; evidence: AnalysisEvidence[];
};
export type NoiseAssessment = {
  verdict: "normal" | "promotional" | "uncertain";
  confidence: number | null;
  evidence: AnalysisEvidence[];
  reasons: ("discount" | "coupon" | "sales" | "marketing_newsletter" | "general_promotion" | "non_promotional" | "insufficient_context")[];
  protectionSignals: { reason: "payment" | "billing" | "contract" | "security" | "account" | "service_outage" | "personal_obligation" | "uncertain_relationship"; evidence: AnalysisEvidence }[];
};
type AnalysisBase = {
  classification: { primaryTopic: string; documentType: Database["public"]["Enums"]["document_type"]; tags: string[] };
  actions: ActionCandidate[]; eventObservations: DateObservation[];
};
export type ItemAnalysis = AnalysisBase & (
  | { schemaVersion: "0.2"; noiseAssessment?: never }
  | { schemaVersion: "0.3"; noiseAssessment: NoiseAssessment }
);
