export type AnalysisDateContext = {
  referenceDate: string;
  timezone: "Asia/Seoul";
  source: "manual";
  basis: "created_at";
};

/** Derive provenance on the server, never from model output or the request body. */
export function analysisDateContext(item: { source: string; created_at?: string | null; source_created_at?: string | null }): AnalysisDateContext | undefined {
  if (item.source !== "manual") return;
  const timestamp = item.created_at;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return;
  return {
    referenceDate: new Date(Date.parse(timestamp) + 9 * 3_600_000).toISOString().slice(0, 10),
    timezone: "Asia/Seoul", source: "manual", basis: "created_at",
  };
}

/** A deliberately narrow, deterministic interpretation of a literal Korean month/day. */
export function resolveYearlessDate(rawText: string, evidence: string, context?: AnalysisDateContext): string | null {
  if (!context || context.source !== "manual" || context.timezone !== "Asia/Seoul" || !/^\d{4}-\d{2}-\d{2}$/.test(context.referenceDate)
    || !Number.isFinite(Date.parse(context.referenceDate))
    || new Date(context.referenceDate).toISOString().slice(0, 10) !== context.referenceDate) return null;
  if (/\d{4}\s*(?:년|[-/.])|작년|지난해|내년|올해|매년|해마다|예시|가정|미정|언젠가|아마|당시|예전|잠정|조건부|경우|이면|라면|하면|전후|쯤|무렵|또는|혹은|변경될|변경 가능/i.test(evidence)) return null;
  const matches = [...rawText.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)];
  if (matches.length !== 1) return null;
  const month = Number(matches[0][1]), day = Number(matches[0][2]);
  const future = /예정|다가오는|앞두|참석하세요|제출|까지|마감|신청|응시\s*확인|upcoming|will\b|due\b/i.test(evidence);
  const past = /지난|종료|완료|열렸|진행했|참석했|실시했|was held|completed/i.test(evidence);
  if (future && past) return null;
  const year = Number(context.referenceDate.slice(0, 4));
  const reference = Date.parse(context.referenceDate);
  const candidates = [year - 1, year, year + 1].map(y => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    .filter(date => Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)
    .filter(date => future ? date >= context.referenceDate : past ? date <= context.referenceDate : true)
    .map(date => ({ date, distance: Math.abs(Date.parse(date) - reference) }))
    .sort((a, b) => a.distance - b.distance);
  const first = candidates[0];
  if (!first || first.distance === candidates[1]?.distance || (!future && !past && first.date < context.referenceDate)) return null;
  return first.date;
}
