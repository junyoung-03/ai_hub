const quote = text => ({ text, locator: { kind: "unknown", page: null, section: null, startChar: null, endChar: null, field: null } });
const none = () => ({ status: "none", date: null, datetime: null, rawText: null, evidence: null });
const observation = (text, rawText) => ({ status: "needs_review", date: null, datetime: null, rawText, evidence: quote(text) });
const result = () => ({ schemaVersion: "0.2", classification: { primaryTopic: "일정", documentType: "schedule", tags: [] }, actions: [], eventObservations: [] });
function action(text, rawText, title) {
  return { title, actionType: "required", requirements: [], conditions: [], startObservation: none(), deadlineObservation: observation(text, rawText), evidence: [quote(text)] };
}
export const reference = { source: "manual", created_at: "2026-10-12T01:00:00Z", source_created_at: null };
export const cases = [
  { name: "manual-event", source: "manual", text: "10월 24일 코딩테스트", output: { ...result(), eventObservations: [observation("10월 24일 코딩테스트", "10월 24일")] }, actions: 0, events: 1 },
  { name: "manual-deadline", source: "manual", text: "10월 24일까지 코딩 과제 제출", output: { ...result(), actions: [action("10월 24일까지 코딩 과제 제출", "10월 24일", "코딩 과제 제출")] }, actions: 1, events: 0 },
  { name: "manual-mixed", source: "manual", text: "10월 24일 코딩테스트, 10월 20일까지 응시 확인", output: { ...result(), actions: [action("10월 20일까지 응시 확인", "10월 20일", "응시 확인")], eventObservations: [observation("10월 24일 코딩테스트", "10월 24일")] }, actions: 1, events: 1 },
  { name: "manual-promotion-candidate", source: "manual", text: "신제품 50% 할인 이벤트", output: { ...result(), classification: { primaryTopic: "제품 홍보", documentType: "other", tags: ["할인"] } }, actions: 0, events: 0 },
  { name: "manual-personal-event", source: "manual", text: "10월 24일 채용 코딩테스트에 참석하세요", output: { ...result(), eventObservations: [observation("10월 24일 채용 코딩테스트에 참석하세요", "10월 24일")] }, actions: 0, events: 1 },
  { name: "gmail-promotion-candidate", source: "gmail", text: "신제품 출시 기념 50% 할인! 쿠폰을 확인하고 쇼핑하세요.", output: { ...result(), classification: { primaryTopic: "제품 홍보", documentType: "other", tags: ["쿠폰"] } }, actions: 0, events: 0 },
  ...["결제", "보안", "계약", "마감"].map(kind => {
    const text = `${kind} 안내: 2026년 10월 24일까지 계정을 확인하세요`;
    const candidate = action(text, "2026년 10월 24일", "계정 확인");
    candidate.deadlineObservation.status = "confirmed";
    candidate.deadlineObservation.date = "2026-10-24";
    return { name: `gmail-important-${kind}`, source: "gmail", text, output: { ...result(), classification: { primaryTopic: kind, documentType: kind === "결제" ? "billing" : kind === "계약" ? "contract" : "notice", tags: [] }, actions: [candidate] }, actions: 1, events: 0 };
  }),
];
