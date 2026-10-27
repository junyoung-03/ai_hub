import type { ProcessingSnapshot } from "@/lib/items/processing";

export const PROCESSING_POLL_INTERVAL = 5_000;
export const PROCESSING_POLL_LIMIT = 5 * 60_000;
const REQUEST_TIMEOUT = 10_000;
export type PollStopReason = "settled" | "limit" | "error";
export const processingSnapshotKey = (items: ProcessingSnapshot[]) => JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));

/** Read-only, serialized polling. Hidden tabs abort requests; the wall-clock budget never resets. */
export function startProcessingPolling(options: {
  initial: ProcessingSnapshot[];
  deadline: number;
  read: (signal: AbortSignal) => Promise<ProcessingSnapshot[]>;
  onChange: () => void;
  onStop: (reason: PollStopReason) => void;
  isVisible: () => boolean;
  subscribeVisibility: (callback: () => void) => () => void;
}) {
  let current = options.initial;
  let stopped = false, inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const stop = (reason?: PollStopReason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer); clearTimeout(requestTimer); clearTimeout(deadlineTimer); controller?.abort();
    unsubscribe();
    if (reason) options.onStop(reason);
  };
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || inFlight) return;
    if (!current.some(item => item.processing.canPoll)) { stop("settled"); return; }
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) { stop("limit"); return; }
    if (!options.isVisible()) return;
    timer = setTimeout(() => { void tick(); }, Math.min(PROCESSING_POLL_INTERVAL, remaining));
  };
  const tick = async () => {
    if (stopped || inFlight || !options.isVisible()) return;
    if (Date.now() >= options.deadline) { stop("limit"); return; }
    inFlight = true;
    const request = new AbortController(); controller = request;
    requestTimer = setTimeout(() => { stop(Date.now() >= options.deadline ? "limit" : "error"); }, Math.min(REQUEST_TIMEOUT, options.deadline - Date.now()));
    try {
      const next = await options.read(request.signal);
      if (stopped || request.signal.aborted) return;
      if (processingSnapshotKey(next) !== processingSnapshotKey(current)) options.onChange();
      current = next;
    } catch {
      if (!stopped && !request.signal.aborted) stop("error");
    } finally {
      clearTimeout(requestTimer); requestTimer = undefined;
      if (controller === request) controller = undefined;
      inFlight = false;
      schedule();
    }
  };
  const unsubscribe = options.subscribeVisibility(() => {
    if (!options.isVisible()) {
      clearTimeout(timer); clearTimeout(requestTimer); controller?.abort();
    } else schedule();
  });
  const deadlineTimer = setTimeout(() => stop("limit"), Math.max(0, options.deadline - Date.now()));
  schedule();
  return () => stop();
}
