import { createHash } from "node:crypto";
import type { Json } from "@/types/database";

type Input = { source: string; format: string; content_text: string | null; metadata: Json };
const record = (v: Json | undefined): Record<string, Json | undefined> => v && typeof v === "object" && !Array.isArray(v) ? v : {};
export function analysisFingerprint(contentText: string, model: string, schemaVersion: "0.2" | "0.3" = "0.3") {
  return createHash("sha256").update(JSON.stringify({ schemaVersion, model, contentText })).digest("hex");
}
export function analysisEligible(item: Input) {
  if (!item.content_text?.trim() || item.content_text.length > 200_000) return false;
  if (item.source === "gmail") return item.format === "email";
  if (item.source === "drive") return item.format === "document";
  if (item.source === "manual") return item.format === "text";
  const extraction = record(record(record(item.metadata).upload).extraction);
  return item.source === "upload" && ["pdf", "image"].includes(item.format)
    && extraction.status === "complete" && extraction.version === "upload-text-v1";
}
export function analysisCurrent(item: Input, model: string) {
  const artifact = record(record(item.metadata).aiAnalysis);
  const version = artifact.schemaVersion;
  // Collection must not silently reanalyse historic v0.2 items at rollout.
  return Boolean(model && item.content_text && (version === "0.2" || version === "0.3") && artifact.model === model
    && artifact.inputFingerprint === analysisFingerprint(item.content_text, model, version));
}
