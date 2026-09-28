import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { maintenanceError } from "./maintenance-log";
import { secBudget, secCooldownMs } from "./sec-budget";

type SecContext = { ticker?: string; cik?: string; accession?: string; runId?: string; job?: string; operation?: string };
const context = new AsyncLocalStorage<SecContext>();

export function withSecRequestContext<T>(fields: SecContext, work: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, work);
}

// All SEC transport and response decoding goes through here, so callers cannot
// accidentally suppress diagnostics when recovering from an optional failure.
export async function secRequest<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>, fields: SecContext = {}): Promise<T> {
  const started = Date.now();
  const requestId = randomUUID();
  let response: Response | undefined;
  const state: { phase: "request" | "http" | "decode" } = { phase: "request" };
  const timeout = AbortSignal.timeout(12_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await secBudget.run(signal, async cooldown => {
      signal.throwIfAborted();
      // Automatic redirects would make unbudgeted network requests.
      response = await fetch(url, { ...init, signal, redirect: "error" });
      state.phase = "http";
      if (!response.ok) {
        cooldown(secCooldownMs(response.status, response.headers.get("retry-after")));
        // Cancel rather than buffer the provider's potentially large error page.
        await response.body?.cancel().catch(() => undefined);
        throw Object.assign(new Error(`SEC request failed (${response.status})`), { code: response.status });
      }
      state.phase = "decode";
      return await read(response);
    });
  } catch (error) {
    const cause = (error as { cause?: unknown } | null)?.cause;
    // JSON SyntaxError messages can quote the response body.
    const details = state.phase === "decode" && error instanceof SyntaxError
      ? { code: null, message: "SEC response contains invalid JSON", contention: false }
      : maintenanceError(error);
    // Do not record query strings, credentials, request headers, or response bodies.
    const endpoint = new URL(url);
    const kind = signal.aborted ? (signal.reason?.name === "TimeoutError" ? "timeout" : "aborted")
      : state.phase === "http" ? "http" : state.phase === "decode" ? "decode" : "network";
    console.error(JSON.stringify({
      severity: "ERROR", message: "SEC API request failed", event: "sec_request_failed", provider: "SEC",
      timestamp: new Date().toISOString(), ...context.getStore(), ...fields,
      requestId, endpoint: `${endpoint.origin}${endpoint.pathname}`, method: init.method ?? "GET",
      cik: fields.cik ?? context.getStore()?.cik ?? endpoint.pathname.match(/CIK(\d+)/)?.[1]
        ?? endpoint.pathname.match(/\/Archives\/edgar\/data\/(\d+)\//)?.[1],
      kind, phase: state.phase, status: response?.status ?? null, durationMs: Date.now() - started,
      retryAfter: response?.headers.get("retry-after")?.slice(0, 200) ?? null,
      contentType: response?.headers.get("content-type")?.slice(0, 200) ?? null,
      providerRequestId: response?.headers.get("x-request-id")?.slice(0, 200) ?? null,
      revision: process.env.K_REVISION ?? process.env.GIT_SHA ?? "local",
      execution: process.env.CLOUD_RUN_EXECUTION ?? null, taskAttempt: process.env.CLOUD_RUN_TASK_ATTEMPT ?? null,
      error: details, cause: cause ? maintenanceError(cause) : null,
    }));
    // Preserve status/error identity for the existing queue cooldown and retry logic.
    throw error;
  }
}
