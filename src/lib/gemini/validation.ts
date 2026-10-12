import "server-only";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "../../../AI_OUTPUT_SCHEMA.json";
import type { AnalysisEvidence, DateObservation, ItemAnalysis } from "@/types/analysis";
import { resolveYearlessDate, type AnalysisDateContext } from "@/lib/gemini/date-context";

export class AnalysisValidationError extends Error {
  constructor(public readonly rule = "SCHEMA") { super("ANALYSIS_VALIDATION_FAILED"); }
}
const ajv = new Ajv({ allowUnionTypes: true });
addFormats(ajv);
const matchesSchema = ajv.compile<ItemAnalysis>(schema);
const actionIntent = /해야|하십시오|하세요|해\s?주세요|바랍니다|필수|의무|신청|접수|제출|납부|등록|확인|갱신|응답|예약|결제|취소|참여|가입|선택|변경|수정|회신|검토|구독|해지|must\b|please\b|apply\b|submit\b|pay\b|register\b|rsvp\b|renew\b|verify\b|sign\s?in|confirm\b|join\b|select\b|update\b|reply\b|review\b|subscribe\b|unsubscribe\b/i;
const deadlineIntent = /마감|기한|까지|내에|deadline|due\b|by\b|until\b|no later than/i;
const startIntent = /신청|접수|등록|제출|apply|application|registration|submission/i;

function evidence(source: string, value: AnalysisEvidence) {
  const index = source.indexOf(value.text);
  if (!value.text.trim() || index < 0) throw new AnalysisValidationError("EVIDENCE");
  const chars = Array.from(source);
  const locator = value.locator;
  if (locator.kind === "text_span" && (locator.startChar === null || locator.endChar === null
    || locator.startChar < 0 || locator.endChar <= locator.startChar
    || chars.slice(locator.startChar, locator.endChar).join("") !== value.text)) throw new AnalysisValidationError("LOCATOR");
  if (locator.page !== null || (locator.kind === "unknown" && [locator.section, locator.startChar, locator.endChar, locator.field].some((field) => field !== null))) throw new AnalysisValidationError("LOCATOR");
  const start = Array.from(source.slice(0, index)).length;
  value.locator = { kind: "text_span", page: null, section: null, startChar: start,
    endChar: start + Array.from(value.text).length, field: "content_text" };
}

function explicitDate(text: string, date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const numeric = new RegExp(`\\b${year}\\s*(?:년\\s*|[-/.]\\s*)0?${month}\\s*(?:월\\s*|[-/.]\\s*)0?${day}(?:일|\\b)`);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = `${names[month - 1]}|${names[month - 1]?.slice(0, 3)}`;
  return numeric.test(text) || new RegExp(`(?:${name})\\.?\\s+${day}(?:st|nd|rd|th)?[,]?\\s+${year}|\\b${day}\\s+(?:${name})\\.?[,]?\\s+${year}`, "i").test(text);
}
function observation(source: string, value: DateObservation, role: "start" | "deadline" | "event", context?: AnalysisDateContext) {
  if (value.status === "none") {
    if (role === "event" || [value.date, value.datetime, value.rawText, value.evidence].some((field) => field !== null)) throw new AnalysisValidationError("OBSERVATION");
    return;
  }
  if (!value.rawText?.trim() || !value.evidence) throw new AnalysisValidationError("DATE_EVIDENCE");
  evidence(source, value.evidence);
  if (!value.evidence.text.includes(value.rawText)) throw new AnalysisValidationError("DATE_EVIDENCE");
  if (value.status === "needs_review") {
    if (value.date !== null || value.datetime !== null) throw new AnalysisValidationError("DATE_INFERENCE");
    const resolved = resolveYearlessDate(value.rawText, value.evidence.text, context);
    if (!resolved) return;
    value.status = "confirmed";
    value.date = resolved;
  }
  if (!value.date || (!explicitDate(value.evidence.text, value.date)
    && resolveYearlessDate(value.rawText, value.evidence.text, context) !== value.date)) throw new AnalysisValidationError("DATE_INFERENCE");
  const text = value.evidence.text;
  if (role === "deadline" && (!deadlineIntent.test(text)
    || (/행사일|개최일|takes place|will be held|event date/i.test(text) && !/마감|기한|deadline|due\b/i.test(text)))) throw new AnalysisValidationError("DEADLINE_ROLE");
  if (role === "start" && !startIntent.test(text)) throw new AnalysisValidationError("START_ROLE");
  if (value.datetime) {
    const parts = /T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value.datetime);
    if (!parts || !value.datetime.startsWith(value.date + "T") || !text.includes(`${parts[1]}:${parts[2]}`)
      || !(parts[3] === "Z" ? /\bUTC\b|\bGMT\b|\+00:00/i.test(text) : text.includes(parts[3]))) throw new AnalysisValidationError("TIMEZONE_INFERENCE");
  }
}

export function validateAnalysis(input: unknown, source: string, context?: AnalysisDateContext): ItemAnalysis {
  if (!matchesSchema(input)) throw new AnalysisValidationError();
  const value: ItemAnalysis = structuredClone(input);
  value.classification.primaryTopic = value.classification.primaryTopic.trim();
  if (!value.classification.primaryTopic) throw new AnalysisValidationError("TOPIC");
  value.classification.tags = [...new Set(value.classification.tags.map((tag) => tag.trim()).filter(Boolean))];
  const seen = new Set<string>();
  for (const action of value.actions) {
    action.title = action.title.trim();
    if (!action.title || !actionIntent.test(action.title)) throw new AnalysisValidationError("ACTION_TITLE_INTENT");
    action.evidence.forEach((quote) => evidence(source, quote));
    if (!action.evidence.some((quote) => actionIntent.test(quote.text))) throw new AnalysisValidationError("ACTION_EVIDENCE_INTENT");
    for (const text of [...action.requirements, ...action.conditions]) {
      if (!text.trim() || !source.includes(text)) throw new AnalysisValidationError("REQUIREMENTS");
    }
    observation(source, action.startObservation, "start", context);
    observation(source, action.deadlineObservation, "deadline", context);
    const key = action.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) throw new AnalysisValidationError("DUPLICATE_CANDIDATE");
    seen.add(key);
  }
  value.eventObservations.forEach((event) => observation(source, event, "event", context));
  return value;
}
export { schema as analysisSchema };
