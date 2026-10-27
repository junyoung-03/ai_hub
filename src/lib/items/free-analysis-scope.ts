import "server-only";

/** The app admission API and free worker share one server-controlled scope. */
export function freeAnalysisScope() {
  if (process.env.GMAIL_ANALYSIS_WORKER_ENABLED !== "true" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") throw new Error("FREE_ANALYSIS_DISABLED");
  if ((process.env.GMAIL_ANALYSIS_CRON_SECRET?.trim().length ?? 0) < 32) throw new Error("FREE_ANALYSIS_NOT_CONFIGURED");
  const parse = (value: string | undefined) => [...new Set((value ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean))];
  const users = parse(process.env.GMAIL_ANALYSIS_ALLOWED_USERS), items = parse(process.env.GMAIL_ANALYSIS_DEMO_ITEM_IDS);
  const uuid = (id: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
  if (users.length !== 1 || items.length < 1 || items.length > 3 || [...users, ...items].some(id => !uuid(id))) throw new Error("EXPLICIT_DEMO_SCOPE_REQUIRED");
  return { users, items };
}
