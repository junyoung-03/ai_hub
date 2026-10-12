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
// Both stored versions remain readable; provider schema is selected by the server readiness gate.
export const legacySchema = structuredClone(schema);
legacySchema.properties.schemaVersion.enum = ["0.2"];
delete (legacySchema.properties as Partial<typeof legacySchema.properties>).noiseAssessment;
legacySchema.required = legacySchema.required.filter((key) => key !== "noiseAssessment");
const matchesLegacySchema = ajv.compile<ItemAnalysis>(legacySchema);
const actionIntent = /해야|하십시오|하세요|해\s?주세요|바랍니다|필수|의무|신청|접수|제출|납부|등록|확인|갱신|응답|예약|결제|취소|참여|가입|선택|변경|수정|회신|검토|구독|해지|must\b|please\b|apply\b|submit\b|pay\b|register\b|rsvp\b|renew\b|verify\b|sign\s?in|confirm\b|join\b|select\b|update\b|reply\b|review\b|subscribe\b|unsubscribe\b/i;
const deadlineIntent = /마감|기한|까지|내에|deadline|due\b|by\b|until\b|no later than/i;
const startIntent = /신청|접수|등록|제출|apply|application|registration|submission/i;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\t\v\f\r \u00a0\u2000-\u200b]+/g, " ").trim();
}

export function findNormalizedSpan(source: string, target: string): { start: number; end: number; exact: string } | null {
  const normTarget = normalizeWhitespace(target);
  if (!normTarget) return null;
  const escaped = normTarget.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\u00a0\\u2000-\\u200b]+");
  try {
    const re = new RegExp(escaped, "u");
    const m = re.exec(source);
    if (!m) return null;
    return { start: m.index, end: m.index + m[0].length, exact: m[0] };
  } catch {
    return null;
  }
}

function evidence(source: string, value: AnalysisEvidence) {
  let index = source.indexOf(value.text);
  if (index < 0) {
    const found = findNormalizedSpan(source, value.text);
    if (!found) throw new AnalysisValidationError("EVIDENCE");
    value.text = found.exact;
    index = found.start;
  }
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
  if (!value.evidence.text.includes(value.rawText)) {
    const normEv = normalizeWhitespace(value.evidence.text), normRaw = normalizeWhitespace(value.rawText);
    if (!normRaw || !normEv.includes(normRaw)) throw new AnalysisValidationError("DATE_EVIDENCE");
  }
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
  if (!matchesSchema(input) && !matchesLegacySchema(input)) throw new AnalysisValidationError();
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
    for (let i = 0; i < action.requirements.length; i++) {
      const text = action.requirements[i];
      if (!text.trim()) throw new AnalysisValidationError("REQUIREMENTS");
      if (!source.includes(text)) {
        const found = findNormalizedSpan(source, text);
        if (!found) throw new AnalysisValidationError("REQUIREMENTS");
        action.requirements[i] = found.exact;
      }
    }
    for (let i = 0; i < action.conditions.length; i++) {
      const text = action.conditions[i];
      if (!text.trim()) throw new AnalysisValidationError("REQUIREMENTS");
      if (!source.includes(text)) {
        const found = findNormalizedSpan(source, text);
        if (!found) throw new AnalysisValidationError("REQUIREMENTS");
        action.conditions[i] = found.exact;
      }
    }
    observation(source, action.startObservation, "start", context);
    observation(source, action.deadlineObservation, "deadline", context);
    const key = action.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) throw new AnalysisValidationError("DUPLICATE_CANDIDATE");
    seen.add(key);
  }
  value.eventObservations.forEach((event) => observation(source, event, "event", context));
  if (value.schemaVersion === "0.3") {
    const noise = value.noiseAssessment;
    if (noise.verdict === "promotional" && !noise.evidence.length) throw new AnalysisValidationError("NOISE_EVIDENCE");
    if (noise.verdict === "promotional" && (noise.reasons.includes("non_promotional") || noise.reasons.includes("insufficient_context")
      || !noise.reasons.some((reason) => ["discount", "coupon", "sales", "marketing_newsletter", "general_promotion"].includes(reason)))) throw new AnalysisValidationError("NOISE_REASON");
    if (noise.verdict === "uncertain" && !noise.reasons.includes("insufficient_context")) throw new AnalysisValidationError("NOISE_REASON");
    noise.evidence.forEach((quote) => evidence(source, quote));
    noise.protectionSignals.forEach((signal) => evidence(source, signal.evidence));
  }
  return value;
}
export { schema as analysisSchema };
