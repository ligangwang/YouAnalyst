import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";

function redact(value: string) {
  return value.replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api_?key|api_token|token|key|access_token)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function maintenanceError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; stack?: unknown } | null;
  const code = typeof value?.code === "string" || typeof value?.code === "number" ? value.code : null;
  const message = redact(typeof value?.message === "string" ? value.message : String(error)).slice(0, 4000);
  return { code, message, stack: typeof value?.stack === "string" ? redact(value.stack).slice(0, 12000) : undefined,
    contention: code === 10 || code === "ABORTED" || /contention|10 ABORTED/i.test(message) };
}

export function createMaintenanceLog(job: string, context: Record<string, unknown> = {}) {
  const started = Date.now();
  const runId = randomUUID();
  let stage = "starting";
  let stageStarted = started;
  const emit = (severity: "INFO" | "WARNING" | "ERROR", event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ severity, message: `${job}: ${event}`, job, runId, stage,
      revision: process.env.K_REVISION ?? process.env.GIT_SHA ?? "local",
      execution: process.env.CLOUD_RUN_EXECUTION, taskAttempt: process.env.CLOUD_RUN_TASK_ATTEMPT,
      elapsedMs: Date.now() - started, ...context, ...fields });
    if (severity === "ERROR") console.error(line);
    else if (severity === "WARNING") console.warn(line);
    else console.info(line);
  };
  return { runId, emit, stage(name: string, fields: Record<string, unknown> = {}) {
    emit("INFO", "stage_completed", { durationMs: Date.now() - stageStarted });
    stageStarted = Date.now();
    stage = name;
    emit("INFO", "stage_started", fields);
  } };
}
export type MaintenanceLog = ReturnType<typeof createMaintenanceLog>;

// Observe public transaction calls only; never log document data or query values.
export async function loggedTransaction<T>(db: Firestore, log: MaintenanceLog, context: Record<string, unknown>, work: (tx: Transaction) => Promise<T>): Promise<T> {
  let attempt = 0;
  let lastOperation = "begin";
  const documents = new Set<string>();
  const started = Date.now();
  try {
    const result = await db.runTransaction(async tx => {
      attempt++;
      if (attempt > 1) log.emit("WARNING", "transaction_retry", { ...context, attempt, lastOperation, documents: [...documents] });
      const observed = new Proxy(tx, { get(target, property) {
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          lastOperation = String(property);
          if (["get", "getAll", "set", "update", "delete", "create"].includes(lastOperation)) {
            const refs = lastOperation === "getAll" ? args : args.slice(0, 1);
            for (const ref of refs) {
              const path = (ref as { path?: unknown } | null)?.path;
              if (typeof path === "string") documents.add(path);
            }
          }
          return Reflect.apply(member, target, args);
        };
      } });
      const value = await work(observed);
      lastOperation = "commit";
      return value;
    });
    log.emit("INFO", "transaction_committed", { ...context, attempts: attempt, durationMs: Date.now() - started, documents: [...documents] });
    return result;
  } catch (error) {
    log.emit("ERROR", "transaction_failed", { ...context, attempts: attempt, lastOperation, durationMs: Date.now() - started, documents: [...documents], error: maintenanceError(error) });
    throw error;
  }
}
