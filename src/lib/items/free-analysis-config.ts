import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Configuration is server-only; request bodies never choose owners or ITEMs. */
export function freeAnalysisConfig(authorization: string | null, timestamp?: string | null, signature?: string | null) {
  const secret = process.env.GMAIL_ANALYSIS_CRON_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("FREE_ANALYSIS_NOT_CONFIGURED");
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(authorization ?? "");
  let authorized = actual.length === expected.length && timingSafeEqual(actual,expected);
  // pg_net has a managed request queue. Never place the persistent secret in it.
  // Cron sends only a signature that expires after two minutes.
  if (!authorized && timestamp && signature && /^\d{10}$/.test(timestamp) && /^[a-f0-9]{64}$/.test(signature)
    && Math.abs(Date.now()/1000-Number(timestamp)) <= 120) {
    const signed = createHmac("sha256",secret).update(`POST\n/api/internal/gmail-analysis\n${timestamp}`).digest();
    authorized = timingSafeEqual(Buffer.from(signature,"hex"),signed);
  }
  if (!authorized) throw new Error("UNAUTHORIZED");
  if (process.env.GMAIL_ANALYSIS_WORKER_ENABLED !== "true" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") throw new Error("FREE_ANALYSIS_DISABLED");
  const parse = (value: string | undefined) => [...new Set((value ?? "").split(",").map(v=>v.trim()).filter(Boolean))];
  const users = parse(process.env.GMAIL_ANALYSIS_ALLOWED_USERS), items = parse(process.env.GMAIL_ANALYSIS_DEMO_ITEM_IDS);
  const uuid = (id: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
  if (users.length !== 1 || items.length < 1 || items.length > 3 || [...users,...items].some(id=>!uuid(id))) throw new Error("EXPLICIT_DEMO_SCOPE_REQUIRED");
  return { users,items };
}
