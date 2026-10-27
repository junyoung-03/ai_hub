import type { Json } from "@/types/database";

type JobRpc = "enqueue_gmail_analysis" | "request_gmail_analysis" | "claim_gmail_analysis_job" | "claim_free_gmail_analysis_job" | "finish_gmail_analysis_job";
type RpcResult = { data: Json | null; error: { code?: string } | null };
// Isolated boundary until the approved migration is applied and DB types are regenerated.
export async function analysisJobRpc(client: object, name: JobRpc, args: Record<string, Json | undefined>): Promise<RpcResult> {
  const rpc = (client as { rpc: (name: JobRpc, args: Record<string, Json | undefined>) => PromiseLike<RpcResult> }).rpc.bind(client);
  return rpc(name, args);
}
