import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDriveClient } from "@/lib/google/drive-client";
import { extractDocsText } from "@/lib/google/docs-text";
import { DOCS_MIME, FOLDER_MIME, DriveError, DRIVE_LIMITS, object } from "@/lib/google/drive-contract";
import type { DriveCollectionInput, DriveCollectionResult, DriveFile, DriveFileResult } from "@/types/drive";
import type { Json } from "@/types/database";
import { analysisCurrent, analysisEligible } from "@/lib/items/analysis-policy";

const active = new Set<string>();
export async function collectDrive(input: DriveCollectionInput): Promise<DriveCollectionResult> {
  const user = await requireUser(), cookie = await createClient();
  const { data: connections, error } = await cookie.from("connections").select("id,status")
    .eq("user_id", user.id).eq("provider", "google").limit(2);
  if (error || connections?.length !== 1 || connections[0].status !== "connected") throw new DriveError("CONNECTION_REQUIRED");
  const connectionId = connections[0].id, key = `${user.id}:${connectionId}`;
  if (active.has(key)) throw new DriveError("GOOGLE_UNAVAILABLE");
  active.add(key);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), DRIVE_LIMITS.runMs);
  const result: DriveCollectionResult = { results: [], created: 0, updated: 0, reused: 0, excluded: 0, failed: 0, unprocessed: 0,
    complete: false, capped: false, stopReason: null, pagesRead: 0, downloadedTextBytes: 0, requestId: randomUUID() };
  let reservedBytes = 0, budgetUsed = 0;
  try {
    const drive = await createDriveClient(user.id, connectionId), admin = createAdminClient();
    const ids: string[] = [], seen = new Set<string>();
    if (input.mode === "files") ids.push(...input.fileIds);
    else {
      const folder = await drive.file(input.folderId, controller.signal);
      if (folder.trashed || folder.driveId || folder.mimeType !== FOLDER_MIME) throw new DriveError(folder.driveId ? "SHARED_DRIVE" : "ACCESS_UNAVAILABLE");
      let page: string | null = null; const seenPages = new Set<string>();
      do {
        try {
          const listed = await drive.children(input.folderId, page, controller.signal); result.pagesRead++;
          for (const file of listed.files) {
            if (!file.parents.includes(input.folderId) || file.mimeType !== DOCS_MIME || file.driveId || file.trashed) continue;
            if (!seen.has(file.id) && ids.length < DRIVE_LIMITS.files) { seen.add(file.id); ids.push(file.id); }
          }
          page = listed.nextPageToken;
          if (page && seenPages.has(page)) throw new DriveError("GOOGLE_UNAVAILABLE");
          if (page) seenPages.add(page);
          if (page && ids.length >= DRIVE_LIMITS.files) { result.capped = true; result.stopReason = "FILE_LIMIT"; break; }
          if (page && result.pagesRead >= DRIVE_LIMITS.pages) { result.capped = true; result.stopReason = "PAGE_LIMIT"; break; }
        } catch {
          result.stopReason = controller.signal.aborted ? "RUN_TIMEOUT" : "LIST_FAILED"; result.capped = controller.signal.aborted; break;
        }
      } while (page);
    }
    function eligibility(file: DriveFile): DriveFileResult["code"] | null {
      return file.driveId ? "SHARED_DRIVE" : file.trashed ? "TRASHED" : file.mimeType !== DOCS_MIME ? "NOT_GOOGLE_DOCS" : null;
    }
    async function processFile(fileId: string): Promise<DriveFileResult> {
      if (controller.signal.aborted) return { fileId, outcome: "unprocessed", code: "RUN_TIMEOUT" };
      const fileSignal = AbortSignal.timeout(DRIVE_LIMITS.fileMs), signal = AbortSignal.any([fileSignal, controller.signal]);
      let reservation = 0, bodyStarted = false;
      try {
        const before = await drive.file(fileId, signal), excluded = eligibility(before);
        if (excluded) return { fileId, outcome: "excluded", code: excluded };
        if (input.mode === "folder" && !before.parents.includes(input.folderId)) return { fileId, outcome: "failed", code: "SOURCE_CHANGED" };
        if (!before.createdTime || !before.modifiedTime || !Number.isFinite(Date.parse(before.createdTime)) || !Number.isFinite(Date.parse(before.modifiedTime)))
          throw new DriveError("GOOGLE_UNAVAILABLE");
        const { data: existing, error: readError } = await cookie.from("items").select("id,source_updated_at,updated_at")
          .eq("user_id", user.id).eq("connection_id", connectionId).eq("source", "drive").is("external_container_id", null)
          .eq("external_id", fileId).abortSignal(signal).maybeSingle();
        if (readError) throw new DriveError("STORAGE_FAILED");
        if (existing?.source_updated_at && Date.parse(existing.source_updated_at) === Date.parse(before.modifiedTime))
          return { fileId, outcome: "reused", itemId: existing.id };
        // Reserve a full document before reading it; concurrent downloads cannot overbook the run budget.
        if (budgetUsed + reservedBytes + DRIVE_LIMITS.bytes > DRIVE_LIMITS.totalBytes) {
          result.capped = true; result.stopReason = "RUN_BYTES_LIMIT";
          return { fileId, outcome: "unprocessed", code: "RUN_BYTES_LIMIT" };
        }
        reservation = DRIVE_LIMITS.bytes; reservedBytes += reservation;
        bodyStarted = true;
        const extracted = extractDocsText(await drive.document(fileId, signal));
        budgetUsed += extracted.bytes;
        result.downloadedTextBytes += extracted.bytes;
        reservedBytes -= reservation; reservation = 0;
        const after = await drive.file(fileId, signal);
        signal.throwIfAborted();
        if (eligibility(after) || before.modifiedTime !== after.modifiedTime
          || (input.mode === "folder" && !after.parents.includes(input.folderId))) throw new DriveError("SOURCE_CHANGED");
        const originalUrl = `https://docs.google.com/document/d/${fileId}/edit`;
        const { data, error: saveError } = await admin.rpc("persist_drive_item", {
          p_user_id: user.id, p_connection_id: connectionId, p_file_id: fileId,
          p_title: after.name, p_original_url: originalUrl, p_content_text: extracted.text,
          p_content_hash: createHash("sha256").update(extracted.text, "utf8").digest("hex"),
          p_source_created_at: before.createdTime, p_source_updated_at: before.modifiedTime,
          p_expected_item_updated_at: existing?.updated_at ?? null,
          p_drive_metadata: { ...extracted.metadata, parents: after.parents, mimeType: after.mimeType,
            webViewLink: after.webViewLink ?? null, collectedAt: new Date().toISOString() } as Json,
        }).abortSignal(signal);
        if (saveError) throw new DriveError(saveError.code === "40001" ? "SOURCE_CHANGED" : "STORAGE_FAILED");
        const saved = object(data);
        if (typeof saved.item_id !== "string" || !["created", "updated", "reused"].includes(String(saved.outcome))) throw new DriveError("STORAGE_FAILED");
        return { fileId, outcome: saved.outcome as "created" | "updated" | "reused", itemId: saved.item_id };
      } catch (error) {
        const code = controller.signal.aborted ? "RUN_TIMEOUT" : fileSignal.aborted ? "FILE_TIMEOUT"
          : error instanceof DriveError ? error.code : "GOOGLE_UNAVAILABLE";
        return { fileId, outcome: "failed", code };
      } finally {
        // An incomplete/oversized body has unknown size. Keep its full reservation
        // charged rather than allowing repeated failing downloads to evade the quota.
        if (bodyStarted && reservation) budgetUsed += reservation;
        reservedBytes -= reservation;
      }
    }
    for (let offset = 0; offset < ids.length; offset += DRIVE_LIMITS.parallel) {
      if (controller.signal.aborted) { result.capped = true; result.stopReason = "RUN_TIMEOUT"; }
      if (result.stopReason === "RUN_TIMEOUT" || result.stopReason === "RUN_BYTES_LIMIT") {
        result.results.push(...ids.slice(offset).map(fileId => ({ fileId, outcome: "unprocessed" as const, code: result.stopReason as "RUN_TIMEOUT" | "RUN_BYTES_LIMIT" }))); break;
      }
      result.results.push(...await Promise.all(ids.slice(offset, offset + DRIVE_LIMITS.parallel).map(processFile)));
    }
    for (const row of result.results) result[row.outcome]++;
    result.complete = !result.capped && !result.stopReason && result.failed === 0 && result.unprocessed === 0;
    if (typeof admin.from === "function") {
      await storeDriveSyncState(admin, user.id, connectionId, result).catch(() => {});
    }
    let analysisItemIds: string[] = [], analysisDiscoveryFailed = false;
    try {
      const ids = result.results.flatMap(row => row.itemId ? [row.itemId] : []);
      if (ids.length) {
        const { data: rows, error: candidateError } = await cookie.from("items").select("id,source,format,content_text,metadata").eq("user_id", user.id).in("id", ids).limit(DRIVE_LIMITS.files);
        if (candidateError || !rows) throw new Error();
        analysisItemIds = rows.filter(row => analysisEligible(row) && !analysisCurrent(row, process.env.GEMINI_MODEL ?? "")).map(row => row.id);
      }
    } catch { analysisDiscoveryFailed = true; }
    return { ...result, analysisItemIds, analysisDiscoveryFailed };
  } finally { clearTimeout(timer); active.delete(key); }
}

async function storeDriveSyncState(admin: ReturnType<typeof createAdminClient>, userId: string, connectionId: string, result: DriveCollectionResult) {
  if (typeof admin.from !== "function") return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current, error: readError } = await admin.from("connections").select("id,sync_state,updated_at")
      .eq("id", connectionId).eq("user_id", userId).eq("provider", "google").eq("status", "connected").maybeSingle();
    if (readError || !current) return;
    const state = object(current.sync_state), drive = object(state.drive);
    const isSuccess = result.complete && result.failed === 0;
    const now = new Date().toISOString();
    const driveState = {
      ...drive,
      last_synced_at: isSuccess ? now : (drive.last_synced_at ?? null),
      last_result: {
        created: result.created,
        updated: result.updated,
        reused: result.reused,
        excluded: result.excluded,
        failed: result.failed,
        unprocessed: result.unprocessed,
        complete: result.complete,
      },
      last_error: isSuccess ? null : (result.failed > 0 ? "PARTIAL_FAILURE" : null),
    };
    const updatePayload = {
      sync_state: { ...state, drive: driveState } as Json,
      ...(isSuccess ? { last_synced_at: now } : {}),
    };
    const { data, error: updateError } = await admin.from("connections").update(updatePayload)
      .eq("id", connectionId).eq("user_id", userId).eq("updated_at", current.updated_at).select("id").maybeSingle();
    if (!updateError && data) return;
  }
}
