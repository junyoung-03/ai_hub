import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET, record, uuid, uploadPath, parseUploadRequest, UploadError } from "@/lib/uploads/contract";

/** Server job entry point, deliberately absent from public routes. Dry run by default. */
export async function cleanupUploads({ apply = false }: { apply?: boolean } = {}) {
  const admin = createAdminClient(AbortSignal.timeout(20_000));
  const { data, error } = await admin.rpc("upload_cleanup_candidates", {});
  if (error || !Array.isArray(data)) throw new UploadError("STORAGE_UNAVAILABLE");
  let eligible = 0, removed = 0;
  for (const candidate of data) {
    const row = record(candidate);
    if (!uuid(row.id) || !uuid(row.user_id)) throw new UploadError("STORAGE_UNAVAILABLE");
    eligible++;
    if (!apply) continue;
    const args = { p_operation: "cleanup_claim", p_user_id: row.user_id, p_upload_id: row.id,
      p_key: null, p_request: null, p_payload: null, p_attempt: null };
    const { data: claimed, error: claimError } = await admin.rpc("upload_session_rpc", args);
    if (claimError) continue; // A retry/ITEM reference may have won the short DB lock.
    const session = record(claimed), request = parseUploadRequest(session.request);
    if (!uuid(session.attempt) || session.path !== uploadPath(row.user_id, row.id, request.mimeType)) throw new UploadError("STORAGE_UNAVAILABLE");
    const { error: removeError } = await admin.storage.from(UPLOAD_BUCKET).remove([String(session.path)]);
    if (removeError) continue; // Retry only after cleanup lease expires; never delete a prefix.
    const { error: finishError } = await admin.rpc("upload_session_rpc", { ...args, p_operation: "cleanup_done", p_attempt: session.attempt });
    if (!finishError) removed++;
  }
  return { eligible, removed, dryRun: !apply };
}
