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
    return result;
  } finally { clearTimeout(timer); active.delete(key); }
}
