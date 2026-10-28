import type { Enums, Json } from "@/types/database";

export type AnalysisJobStatus = { itemId: string; state: string; leaseUntil: string | null; availableAt: string | null; schedulerAvailable: boolean; waitingForBudget?: boolean };
export type ProcessingSummary = {
  status: Enums<"processing_status">;
  label: string;
  message: string;
  canAnalyze: boolean;
  canPoll: boolean;
  errorCode: string | null;
  updatedAt: string | null;
};
export type ProcessingSnapshot = { id: string; processing: ProcessingSummary };

const errors: Record<string, string> = {
  GEMINI_HTTP_429: "AI 요청 한도에 도달했습니다. 잠시 기다린 뒤 다시 시도해 주세요.",
  GEMINI_HTTP_401: "AI 서비스 인증 설정을 확인해야 합니다. 관리자에게 문의해 주세요.",
  GEMINI_HTTP_403: "AI 서비스 접근 권한을 확인해야 합니다. 관리자에게 문의해 주세요.",
  GEMINI_HTTP_400: "AI 요청을 처리하지 못했습니다. 자료를 확인하거나 관리자에게 문의해 주세요.",
  GEMINI_HTTP_404: "AI 모델 설정을 확인해야 합니다. 관리자에게 문의해 주세요.",
  GEMINI_HTTP_500: "AI 서비스에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_HTTP_502: "AI 서비스에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_HTTP_503: "AI 서비스에 일시적인 오류가 있습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_HTTP_504: "AI 서비스 응답이 지연됐습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_TIMEOUT: "AI 응답 대기 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_NETWORK_ERROR: "AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_UNAVAILABLE: "AI 서비스를 이용하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_NOT_CONFIGURED: "AI 서비스 설정이 필요합니다. 관리자에게 문의해 주세요.",
  GEMINI_INCOMPLETE: "AI 응답이 끝까지 도착하지 않았습니다. 다시 시도해 주세요.",
  ANALYSIS_VALIDATION_FAILED: "AI 결과를 원문과 대조해 검증하지 못했습니다. 원문을 확인한 뒤 다시 시도해 주세요.",
  ANALYSIS_VALIDATION_SCHEMA: "AI 결과 형식이 올바르지 않습니다. 분석을 다시 시도해 주세요.",
  ANALYSIS_VALIDATION_EVIDENCE: "AI가 제시한 근거를 원문에서 찾지 못했습니다.",
  ANALYSIS_VALIDATION_LOCATOR: "AI가 제시한 근거의 위치를 확인하지 못했습니다.",
  ANALYSIS_VALIDATION_OBSERVATION: "AI 날짜 결과의 형식을 확인하지 못했습니다.",
  ANALYSIS_VALIDATION_DATE_EVIDENCE: "AI가 제시한 날짜의 원문 근거를 확인하지 못했습니다.",
  ANALYSIS_VALIDATION_DATE_INFERENCE: "AI가 제시한 날짜를 원문에서 확정하지 못했습니다.",
  ANALYSIS_VALIDATION_DEADLINE_ROLE: "행사 날짜와 마감일을 구분해 검증하지 못했습니다.",
  ANALYSIS_VALIDATION_START_ROLE: "AI가 제시한 시작 날짜의 의미를 검증하지 못했습니다.",
  ANALYSIS_VALIDATION_TIMEZONE_INFERENCE: "AI가 제시한 시간대의 원문 근거를 확인하지 못했습니다.",
  ANALYSIS_VALIDATION_TOPIC: "AI 분류 주제가 비어 있습니다.",
  ANALYSIS_VALIDATION_ACTION_TITLE_INTENT: "AI가 제시한 할 일의 행동 표현을 검증하지 못했습니다.",
  ANALYSIS_VALIDATION_ACTION_EVIDENCE_INTENT: "AI가 제시한 할 일의 행동 근거를 검증하지 못했습니다.",
  ANALYSIS_VALIDATION_REQUIREMENTS: "AI가 제시한 요구사항이나 조건을 원문에서 찾지 못했습니다.",
  ANALYSIS_VALIDATION_DUPLICATE_CANDIDATE: "AI가 중복된 할 일 후보를 반환했습니다.",
  ANALYSIS_VALIDATION_NOISE_EVIDENCE: "광고 분류의 원문 근거를 검증하지 못했습니다.",
  ANALYSIS_VALIDATION_NOISE_REASON: "광고 분류 사유를 검증하지 못했습니다.",
  ANALYSIS_STORAGE_UNAVAILABLE: "분석 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  ANALYSIS_PERSISTENCE_REJECTED: "자료가 변경되어 분석 결과를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.",
  ANALYSIS_ATTEMPTS_EXHAUSTED: "자동 재시도 횟수를 모두 사용했습니다. 원인을 확인한 뒤 직접 다시 시도해 주세요.",
  ANALYSIS_WORKER_INTERRUPTED: "분석 작업이 중단됐습니다. 다시 시도해 주세요.",
  ANALYSIS_SCOPE_UNAVAILABLE: "이 자료는 현재 백그라운드 분석 대상이 아닙니다. 관리자에게 문의해 주세요.",
  ANALYSIS_WORKER_UNAVAILABLE: "백그라운드 분석을 시작할 수 없습니다. 관리자에게 문의해 주세요.",
  ANALYSIS_WORKER_PAUSED: "백그라운드 분석 일정이 중지됐거나 오늘의 처리 한도에 도달했습니다. 관리자에게 문의해 주세요.",
  ANALYSIS_IN_PROGRESS: "이미 분석이 진행 중입니다. 잠시 후 상태를 확인해 주세요.",
  INVALID_ANALYSIS_INPUT: "분석 가능한 본문과 자료 형식을 확인해 주세요.",
  ANALYSIS_FAILED: "분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  EMPTY_TEXT: "파일에서 본문을 추출하지 못했습니다. 텍스트가 있는 파일로 다시 올려 주세요.",
  OCR_FAILED: "문자 인식에 실패했습니다. 원본 파일을 확인하고 업로드를 다시 시도해 주세요.",
  OCR_UNAVAILABLE: "문자 인식을 실행하지 못했습니다. 업로드 화면에서 다시 시도해 주세요.",
  PROCESSING_TIMEOUT: "파일 추출 시간이 초과됐습니다. 업로드 화면에서 다시 시도해 주세요.",
  TEXT_LIMIT: "추출된 본문이 처리 한도를 넘습니다. 파일을 나누어 다시 올려 주세요.",
  PDF_ENCRYPTED: "암호가 설정된 PDF는 추출할 수 없습니다. 암호를 해제한 파일을 올려 주세요.",
  PDF_UNSAFE: "이 PDF를 안전하게 추출할 수 없습니다. 다른 파일로 다시 올려 주세요.",
  PDF_LAYOUT_NEEDS_REVIEW: "PDF의 텍스트 배치를 확인해야 합니다. 원문을 확인해 주세요.",
};
const object = (value: Json | undefined): Record<string, Json | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const processingErrorMessage = (code: unknown): string | null => typeof code === "string" && Object.hasOwn(errors, code) ? errors[code] : null;

/** Display-only projection. Never returns raw errors, provider responses, or source text. */
export function summarizeProcessing(item: {
  source: string; format: string; content_text: string | null; metadata?: Json;
  processing_status: Enums<"processing_status">; processing_error?: string | null; updated_at?: string;
}, eligible: boolean, job?: AnalysisJobStatus): ProcessingSummary {
  const status = item.processing_status;
  const errorCode = item.processing_error && Object.hasOwn(errors, item.processing_error) ? item.processing_error : null;
  const result: ProcessingSummary = { status, label: "분석 대기", message: "상세 화면에서 AI 분석을 요청할 수 있습니다.", canAnalyze: eligible, canPoll: false, errorCode,
    updatedAt: item.updated_at && Number.isFinite(Date.parse(item.updated_at)) ? item.updated_at : null };
  if (item.source === "calendar") return { ...result, label: "일정 자료", message: "Calendar 일정은 원문 일정으로 표시하며 AI 분석 대상이 아닙니다.", canAnalyze: false };
  const extraction = object(object(object(item.metadata).upload).extraction);
  if (status === "extracting" && item.source === "upload" && extraction.status === "running") return { ...result, label: "콘텐츠 추출 중", message: "파일에서 본문을 추출하고 있습니다.", canAnalyze: false, canPoll: true };
  if (!item.content_text?.trim()) return { ...result, label: "분석 불가 · 본문 없음", message: errorCode ? errors[errorCode] : "저장된 본문이 없어 분석할 수 없습니다. 원문을 확인하고 본문이 있는 자료를 다시 수집하거나 업로드해 주세요.", canAnalyze: false };
  if (item.content_text.length > 200_000) return { ...result, label: "분석 불가 · 본문 한도 초과", message: "본문이 분석 한도를 넘습니다. 자료를 나누어 다시 추가해 주세요.", canAnalyze: false };
  if (!eligible) return { ...result, label: "분석 대상 아님", message: item.source === "upload" ? "파일의 본문 추출을 먼저 완료해 주세요." : "이 자료 형식은 현재 AI 분석을 지원하지 않습니다.", canAnalyze: false };
  const liveLease = job?.state === "running" && Boolean(job.leaseUntil && Date.parse(job.leaseUntil) > Date.now());
  if (job?.waitingForBudget && ["pending", "retry"].includes(job.state)) return { ...result, label: "분석 대기 · 오늘 한도", message: "오늘의 분석 처리량에 도달했습니다. 작업은 보존되며 다음 예산 주기에 계속합니다.", canAnalyze: false, canPoll: false };
  if (status === "failed" && job?.state === "retry" && job.schedulerAvailable) return { ...result, label: "분석 재시도 대기", message: `${errorCode ? errors[errorCode] : errors.ANALYSIS_FAILED} 등록된 작업이 자동 재시도를 기다리고 있습니다.`, canAnalyze: false, canPoll: true };
  if (status === "failed") return { ...result, label: "분석 실패 · 상세에서 확인", message: errorCode ? errors[errorCode] : errors.ANALYSIS_FAILED };
  if (status === "completed") return { ...result, label: "분석 완료", message: "분석과 검색 준비가 완료되었습니다." };
  if (status === "analyzing") {
    if (job && !liveLease) return { ...result, label: "분석 중단 확인 필요", message: "분석 작업의 실행 시간이 만료됐습니다. 상태를 다시 확인하거나 관리자에게 문의해 주세요.", canAnalyze: false };
    return { ...result, label: "분석 중", message: "AI가 저장된 본문을 분석하고 있습니다.", canAnalyze: false, canPoll: true };
  }
  if (status === "indexing") return { ...result, label: "검색 준비 중", message: "AI 분석은 완료됐습니다. 검색 준비가 남아 있으면 상세 화면에서 이어갈 수 있습니다.", canPoll: true };
  if (status === "queued" && job && ["pending", "running", "retry"].includes(job.state)) {
    const active = liveLease || (job.state !== "running" && job.schedulerAvailable);
    return { ...result, label: active ? job.state === "retry" ? "분석 재시도 대기" : "분석 대기" : "분석 대기 · 실행 확인 필요", message: active ? "등록된 백그라운드 분석 작업을 기다리고 있습니다." : "백그라운드 분석 일정·처리 한도·실행 시간을 확인해야 합니다. 관리자에게 문의해 주세요.", canPoll: active };
  }
  return result;
}
