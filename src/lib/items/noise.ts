import "server-only";
import { promotionalReady } from "@/lib/items/promotional-gate";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isItemId } from "@/lib/items/filters";
import { ItemWriteError } from "@/lib/items/writes";
import type { Json } from "@/types/database";
import type { AnalysisEvidence } from "@/types/analysis";

export type NoiseOverride = "force_show" | "force_promotional" | null;
export type NoiseState = {
  aiVerdict: "normal" | "promotional" | "uncertain" | null;
  userOverride: NoiseOverride;
  effectiveVisibility: "SHOW" | "HIDE";
  protectionState: string[];
  confidence?: number | null;
  evidence?: AnalysisEvidence[];
  reasons?: string[];
  assessmentVersion?: string | null;
};
export function parseNoiseOverride(input: unknown): NoiseOverride {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).join(",") !== "userOverride") throw new ItemWriteError("VALIDATION_ERROR");
  const value = (input as { userOverride: unknown }).userOverride;
  if (value !== null && value !== "force_show" && value !== "force_promotional") throw new ItemWriteError("VALIDATION_ERROR");
  return value;
}
export async function noiseState(itemId: string, patch?: unknown): Promise<NoiseState> {
  const user = await requireUser();
  if (!isItemId(itemId)) throw new ItemWriteError("NOT_FOUND", 404);
  const override = patch === undefined ? undefined : parseNoiseOverride(patch);
  if (!await promotionalReady()) throw new ItemWriteError("NOT_FOUND", 404);
  const client = await createClient();
  const { data: item, error: itemError } = await client.from("items").select("source").eq("id", itemId).eq("user_id", user.id).maybeSingle();
  if (itemError) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  if (!item || item.source !== "gmail") throw new ItemWriteError("NOT_FOUND", 404);
  // Explicit adapter until the reviewed migration is deployed and types can be regenerated.
  const rpc = client.rpc.bind(client) as unknown as (name: "get_item_noise_state" | "set_noise_override", args: Record<string, Json>) => PromiseLike<{ data: unknown; error: { code: string } | null }>;
  const { data, error } = await rpc(override === undefined ? "get_item_noise_state" : "set_noise_override",
    { p_item_id: itemId, ...(override === undefined ? {} : { p_override: override }) });
  if (error) throw new ItemWriteError(error.code === "P0002" ? "NOT_FOUND" : "STORAGE_UNAVAILABLE", error.code === "P0002" ? 404 : 503);
  if (!data || typeof data !== "object" || !("effectiveVisibility" in data)
    || !["SHOW", "HIDE"].includes(String(data.effectiveVisibility))) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  return data as NoiseState;
}
