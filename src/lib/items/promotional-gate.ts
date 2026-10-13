import "server-only";
import { createClient } from "@/lib/supabase/server";

/** No positive process cache: every operation can observe a removed/stale contract. */
export async function promotionalReady(): Promise<boolean> {
  if (process.env.PROMOTIONAL_NOISE_ENABLED !== "true") return false;
  try {
    const client = await createClient();
    const rpc = client.rpc.bind(client) as unknown as (name: string) => ReturnType<typeof client.rpc>;
    const from = client.from.bind(client) as unknown as (name: string) => ReturnType<typeof client.from>;
    const signal = AbortSignal.timeout(2_000);
    const contract = await rpc("gmail_promotional_ready").abortSignal(signal);
    if (contract.error || contract.data !== true) return false;
    // Check the REST schema cache too, without loading any user rows.
    const [assessment, visibility] = await Promise.all([
      from("item_noise_assessments").select("item_id").limit(0).abortSignal(signal),
      client.from("items").select("id").filter("item_is_visible", "eq", true).limit(0).abortSignal(signal),
    ]);
    return !assessment.error && !visibility.error;
  } catch { return false; }
}

export function missingPromotionalContract(error: { code?: string } | null): boolean {
  return !!error && ["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "");
}
