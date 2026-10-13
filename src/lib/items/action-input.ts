import { ItemWriteError } from "./writes";

/** Shared create/edit contract: explicit user dates only, interpreted in Seoul. */
export function parseActionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ItemWriteError("VALIDATION_ERROR");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["title", "date", "time"].includes(key)) ||
      typeof v.title !== "string" || !v.title.trim() || v.title.trim().length > 200 || /[\x00-\x1f\x7f]/.test(v.title) ||
      typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new ItemWriteError("VALIDATION_ERROR");
  const date = new Date(`${v.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.date || v.date < "1900-01-01") throw new ItemWriteError("VALIDATION_ERROR");
  if (v.time != null && v.time !== "" && (typeof v.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))) throw new ItemWriteError("VALIDATION_ERROR");
  return { title: v.title.trim().normalize("NFC"), date: v.date, deadlineAt: v.time ? `${v.date}T${v.time}:00+09:00` : null };
}
