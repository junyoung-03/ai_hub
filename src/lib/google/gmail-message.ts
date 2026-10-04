import "server-only";

import { createHash } from "node:crypto";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : {};
}
const string = (value: unknown) => typeof value === "string" ? value : "";
const normalize = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function decode(data: string, charset = "utf-8") {
  if (data.length > 2_800_000 || !/^[A-Za-z0-9_-]*={0,2}$/.test(data) || data.replace(/=+$/, "").length % 4 === 1) throw new Error("Invalid message body.");
  const bytes = Buffer.from(data, "base64url");
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function headerValue(value: string) {
  // RFC 2047 adjacent encoded words have no intervening whitespace.
  return value.replace(/(\?=)\s+(?==\?)/g, "$1").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (original, charset: string, mode: string, text: string) => {
    try {
      const bytes = mode.toLowerCase() === "b" ? Buffer.from(text, "base64")
        : Buffer.from(text.replace(/_/g, " ").replace(/=([a-f0-9]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      return new TextDecoder(charset).decode(bytes);
    } catch { return original; }
  }).replace(/[\r\n\u0000]+/g, " ").trim();
}

function headers(part: RecordValue) {
  const result: Record<string, string> = {};
  for (const raw of Array.isArray(part.headers) ? part.headers : []) {
    const value = record(raw), name = string(value.name).toLowerCase();
    if (["subject", "from", "to", "cc", "bcc", "date", "content-type", "content-disposition"].includes(name)) {
      result[name] = headerValue(string(value.value));
    }
  }
  return result;
}

export function htmlToText(html: string) {
  const root = parseFragment(html);
  const output: string[] = [];
  const blocks = new Set(["p", "div", "section", "article", "header", "footer", "blockquote", "pre", "ul", "ol", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const stack: (DefaultTreeAdapterTypes.Node | string)[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") { output.push(node); continue; }
    if ("tagName" in node) {
      if (["script", "style", "template", "noscript", "head", "svg", "img"].includes(node.tagName)) continue;
      if (node.tagName === "br") output.push("\n");
      if (blocks.has(node.tagName)) { output.push("\n"); stack.push("\n"); }
      if (["td", "th"].includes(node.tagName)) output.push(" ");
    }
    if ("value" in node && node.nodeName === "#text") output.push(node.value);
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  return normalize(output.join(""));
}

export function mapGmailMessage(raw: unknown, expectedId: string) {
  const message = record(raw), payload = record(message.payload);
  if (string(message.id) !== expectedId || !/^[A-Za-z0-9_-]{1,255}$/.test(expectedId)) throw new Error("Invalid message identity.");
  const internalDate = string(message.internalDate);
  const millis = /^\d+$/.test(internalDate) ? Number(internalDate) : Number.NaN;
  const date = new Date(millis);
  if (!Number.isFinite(millis) || !Number.isFinite(date.getTime())) throw new Error("Invalid message date.");
  const attachments: { filename: string; mimeType: string; hasAttachmentId: boolean; size: number }[] = [];
  let partCount = 0;
  function body(rawPart: unknown, depth: number): { text: string; plain: boolean } {
    if (++partCount > 1000 || depth > 32) throw new Error("Message structure exceeds limits.");
    const part = record(rawPart), partBody = record(part.body), values = headers(part);
    const mime = string(part.mimeType).toLowerCase(), filename = string(part.filename);
    const attachment = Boolean(filename || /^attachment(?:;|$)/i.test(values["content-disposition"] ?? "") || (!mime.startsWith("multipart/") && !["text/plain", "text/html"].includes(mime)));
    if (attachment) {
      attachments.push({ filename, mimeType: mime, hasAttachmentId: Boolean(string(partBody.attachmentId)), size: typeof partBody.size === "number" && partBody.size >= 0 ? partBody.size : 0 });
      return { text: "", plain: false };
    }
    if (mime.startsWith("multipart/")) {
      const parts = Array.isArray(part.parts) ? part.parts : [];
      const texts = parts.map((child) => body(child, depth + 1));
      if (mime === "multipart/alternative") return texts.find((child) => child.plain && child.text) || texts.find((child) => child.text) || { text: "", plain: false };
      return { text: texts.map((child) => child.text).filter(Boolean).join("\n\n"), plain: texts.some((child) => child.plain && child.text) };
    }
    const encoded = string(partBody.data);
    // Text in an external attachment body is never fetched by this phase.
    if (!encoded) return { text: "", plain: false };
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(values["content-type"] ?? "")?.[1] ?? "utf-8";
    const text = decode(encoded, charset);
    return { text: mime === "text/html" ? htmlToText(text) : normalize(text), plain: mime === "text/plain" };
  }
  const contentText = normalize(body(payload, 0).text);
  if (contentText.length > 2_000_000) throw new Error("Message body exceeds limits.");
  const values = headers(payload);
  const metadata = {
    from: values.from ?? "", to: values.to ?? "", cc: values.cc ?? "", bcc: values.bcc ?? "", date: values.date ?? "",
    snippet: string(message.snippet),
    labelIds: (Array.isArray(message.labelIds) ? message.labelIds.filter((label): label is string => typeof label === "string") : []).sort(),
    threadId: string(message.threadId), historyId: string(message.historyId), attachments,
  };
  const title = values.subject || "(제목 없음)", sourceCreatedAt = date.toISOString();
  const contentHash = createHash("sha256").update(JSON.stringify([title, contentText, sourceCreatedAt, metadata])).digest("hex");
  return { externalId: expectedId, title, contentText, sourceCreatedAt, metadata, contentHash };
}

export type GmailItem = ReturnType<typeof mapGmailMessage>;
