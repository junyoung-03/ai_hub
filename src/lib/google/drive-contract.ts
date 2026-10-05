import type { DriveCollectionInput, DriveFailureCode } from "@/types/drive";
export const DRIVE_LIMITS = Object.freeze({ files: 20, codePoints: 100_000, bytes: 400_000, totalBytes: 2_000_000,
  parallel: 2, requestMs: 10_000, fileMs: 30_000, runMs: 120_000, pageSize: 20, pages: 5 });
export const DOCS_MIME = "application/vnd.google-apps.document";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const isGoogleFileId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value);
export class DriveError extends Error {
  constructor(public readonly code: DriveFailureCode) { super(code); }
}
export function parseDriveInput(value: unknown): DriveCollectionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2) return null;
  if (v.mode === "folder" && isGoogleFileId(v.folderId)) return { mode: "folder", folderId: v.folderId };
  if (v.mode === "files" && Array.isArray(v.fileIds) && v.fileIds.length >= 1 && v.fileIds.length <= DRIVE_LIMITS.files
    && v.fileIds.every(isGoogleFileId) && new Set(v.fileIds).size === v.fileIds.length)
    return { mode: "files", fileIds: v.fileIds };
  return null;
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
