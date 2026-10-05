export type DriveCollectionInput = { mode: "folder"; folderId: string } | { mode: "files"; fileIds: string[] };
export type DriveFile = {
  id: string; name: string; mimeType: string; webViewLink?: string;
  createdTime?: string; modifiedTime?: string; parents: string[]; trashed: boolean; driveId?: string;
};
export type DriveOutcome = "created" | "updated" | "reused" | "excluded" | "failed" | "unprocessed";
export type DriveFailureCode = "ACCESS_UNAVAILABLE" | "SHARED_DRIVE" | "NOT_GOOGLE_DOCS" | "TRASHED"
  | "SOURCE_CHANGED" | "DOCUMENT_LIMIT" | "RUN_BYTES_LIMIT" | "FILE_TIMEOUT" | "RUN_TIMEOUT"
  | "GOOGLE_UNAVAILABLE" | "REFRESH_FAILED" | "STORAGE_FAILED" | "CONNECTION_REQUIRED" | "DRIVE_CONSENT_REQUIRED";
export type DriveFileResult = { fileId: string; outcome: DriveOutcome; itemId?: string; code?: DriveFailureCode };
export type DriveCollectionResult = {
  results: DriveFileResult[]; created: number; updated: number; reused: number; excluded: number; failed: number; unprocessed: number;
  complete: boolean; capped: boolean; stopReason: "FILE_LIMIT" | "PAGE_LIMIT" | "RUN_BYTES_LIMIT" | "RUN_TIMEOUT" | "LIST_FAILED" | null;
  pagesRead: number; downloadedTextBytes: number; requestId: string;
};
export type DocsText = {
  text: string; codePoints: number; bytes: number;
  metadata: {
    extractionVersion: "docs-text-v1"; offsetUnit: "unicode_code_point";
    tabs: { id: string; title: string; parentId: string | null; start: number; end: number }[];
    exclusions: { header: boolean; footer: boolean; footnote: boolean; image: boolean; suggestion: boolean;
      comment: "not_collected"; ocr: "not_collected"; unsupportedStructure: boolean };
  };
};
