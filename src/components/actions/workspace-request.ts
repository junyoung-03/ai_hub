class WorkspaceReadError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "로그인이 만료되었습니다. 다시 로그인해 주세요." : "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

/** Retry only read requests with transient failures, never authentication or missing data. */
export async function readWorkspaceJson<T>(url: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => request.abort(), 12000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new WorkspaceReadError(response.status);
      return await response.json() as T;
    } catch (error) {
      signal.throwIfAborted();
      const transient = error instanceof WorkspaceReadError
        ? [408, 429, 500, 502, 503, 504].includes(error.status)
        : error instanceof TypeError || request.signal.aborted;
      if (attempt >= 1 || !transient) throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    await new Promise<void>((resolve, reject) => {
      const abortWait = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abortWait); resolve(); }, 500);
      signal.addEventListener("abort", abortWait, { once: true });
      if (signal.aborted) { signal.removeEventListener("abort", abortWait); abortWait(); }
    });
  }
}
