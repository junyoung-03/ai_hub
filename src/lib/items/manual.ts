import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export class ManualItemError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "VALIDATION_ERROR" | "STORAGE_UNAVAILABLE", public readonly status = 400) {
    super(code);
  }
}

export async function createManualItem(input: unknown) {
  const user = await requireUser();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ManualItemError("VALIDATION_ERROR", 400);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.content !== "string") {
    throw new ManualItemError("VALIDATION_ERROR", 400);
  }
  const contentText = raw.content.trim();
  if (!contentText) {
    throw new ManualItemError("VALIDATION_ERROR", 400);
  }
  if (contentText.length > 100_000) {
    throw new ManualItemError("VALIDATION_ERROR", 400);
  }

  let title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length > 200) {
    title = title.slice(0, 200);
  }
  if (!title) {
    const firstLine = contentText.split("\n")[0].trim();
    if (firstLine.length > 50) {
      title = firstLine.slice(0, 47) + "...";
    } else if (firstLine) {
      title = firstLine;
    } else {
      title = "직접 입력 메모";
    }
  }

  const contentHash = createHash("sha256").update(contentText).digest("hex");
  const now = new Date();
  const admin = createAdminClient();

  // Double-click protection (5 seconds window with identical content_hash):
  const fiveSecondsAgo = new Date(now.getTime() - 5_000).toISOString();
  const { data: recent, error: recentErr } = await admin.from("items")
    .select("id,title,source,format,processing_status,created_at")
    .eq("user_id", user.id)
    .eq("source", "manual")
    .eq("content_hash", contentHash)
    .gte("created_at", fiveSecondsAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!recentErr && recent) {
    return {
      itemId: recent.id,
      item: {
        id: recent.id,
        title: recent.title,
        source: recent.source,
        format: recent.format,
        processingStatus: recent.processing_status,
      },
    };
  }

  const itemId = randomUUID();
  const externalId = randomUUID();

  const { data: item, error } = await admin.from("items").insert({
    id: itemId,
    user_id: user.id,
    source: "manual",
    format: "text",
    title,
    content_text: contentText,
    content_hash: contentHash,
    external_id: externalId,
    processing_status: "queued",
    metadata: {
      manual: {
        createdAt: now.toISOString(),
      },
    },
  }).select("id,title,source,format,processing_status").single();

  if (error || !item) {
    throw new ManualItemError("STORAGE_UNAVAILABLE", 503);
  }

  return {
    itemId: item.id,
    item: {
      id: item.id,
      title: item.title,
      source: item.source,
      format: item.format,
      processingStatus: item.processing_status,
    },
  };
}
