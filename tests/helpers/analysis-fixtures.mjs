// Synthetic, public test data only. Never a real email.
export const content = "😀 안내\n2026년 10월 20일 설명회가 개최됩니다.\n참가 신청은 2026년 10월 15일까지 접수합니다.\n마감일은 추후 공지합니다.";
export const locator = () => ({ kind: "unknown", page: null, section: null, startChar: null, endChar: null, field: null });
export const quote = (text) => ({ text, locator: locator() });
export const none = () => ({ status: "none", date: null, datetime: null, rawText: null, evidence: null });
export function fixture() {
  const sentence = "참가 신청은 2026년 10월 15일까지 접수합니다.";
  return { schemaVersion: "0.2", classification: { primaryTopic: "설명회", documentType: "notice", tags: ["신청"] },
    actions: [{ title: "설명회 참가 신청", actionType: "optional", requirements: [], conditions: [],
      startObservation: none(), deadlineObservation: { status: "confirmed", date: "2026-10-15", datetime: null,
        rawText: "2026년 10월 15일까지", evidence: quote(sentence) }, evidence: [quote(sentence)] }],
    eventObservations: [{ status: "confirmed", date: "2026-10-20", datetime: null,
      rawText: "2026년 10월 20일", evidence: quote("2026년 10월 20일 설명회가 개최됩니다.") }] };
}
