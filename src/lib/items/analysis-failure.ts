import { GeminiAnalysisError } from "@/lib/gemini/client";
import { AnalysisValidationError } from "@/lib/gemini/validation";

/** Only safe codes leave the server; never persist provider bodies or source content. */
export function analysisFailure(error: unknown, attempt = 1): { code: string; retrySeconds: number | null } {
  const backoff = Math.min(3600, 60 * 2 ** Math.max(0, Math.min(5, attempt - 1)));
  if (error instanceof AnalysisValidationError) return { code: "ANALYSIS_VALIDATION_FAILED", retrySeconds: null };
  if (error instanceof GeminiAnalysisError) {
    if (error.httpStatus) return { code: `GEMINI_HTTP_${error.httpStatus}`, retrySeconds: [429,500,502,503,504].includes(error.httpStatus) ? Math.max(backoff, error.retryAfterSeconds ?? 0) : null };
    if (error.code === "GEMINI_UNAVAILABLE") return { code: error.reason === "timeout" ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR", retrySeconds: backoff };
    return { code: error.code, retrySeconds: error.code === "GEMINI_INCOMPLETE" ? backoff : null };
  }
  if (error && typeof error === "object" && "message" in error && error.message === "ANALYSIS_STORAGE_UNAVAILABLE") return { code: "ANALYSIS_STORAGE_UNAVAILABLE", retrySeconds: backoff };
  if (error && typeof error === "object" && "message" in error && error.message === "ANALYSIS_PERSISTENCE_REJECTED") return { code: "ANALYSIS_PERSISTENCE_REJECTED", retrySeconds: null };
  return { code: "ANALYSIS_FAILED", retrySeconds: null };
}
