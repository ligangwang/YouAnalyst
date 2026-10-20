import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

type TaskAttempt = { execution: string; index: number; attempt: number };

export function cloudRunTaskAttempt(env: Record<string, string | undefined> = process.env): TaskAttempt | undefined {
  const { CLOUD_RUN_EXECUTION: execution, CLOUD_RUN_TASK_INDEX: index, CLOUD_RUN_TASK_ATTEMPT: attempt } = env;
  if (!execution || !index?.match(/^\d+$/) || !attempt?.match(/^\d+$/)) return undefined;
  if (!Number.isSafeInteger(Number(index)) || !Number.isSafeInteger(Number(attempt))) return undefined;
  return { execution, index: Number(index), attempt: Number(attempt) };
}

// Store the lease on the existing job metadata document. Longer than the 20-minute task timeout.
export async function acquireMaintenanceLease(ref: DocumentReference, owner: string, now = Date.now(), task?: TaskAttempt) {
  return (await acquireMaintenanceLeaseState(ref,owner,now,task))!==null;
}

/** Return state from the successful transaction attempt, never a pre-lease read.
 * Reuse it only for this lease's initial cursor; release still checks ownership. */
export async function acquireMaintenanceLeaseState(ref: DocumentReference, owner: string, now = Date.now(), task?: TaskAttempt) {
  return ref.firestore.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    // Cloud Run starts a retry after the previous attempt ends. Recover its lease
    // immediately after a crash, while still excluding other executions/tasks.
    const recovering = task && data?.leaseTask?.execution === task.execution
      && data.leaseTask.index === task.index && task.attempt > data.leaseTask.attempt;
    if (Number(data?.leaseExpiresAtMs) > now && !recovering) return null;
    tx.set(ref, { leaseOwner: owner, leaseExpiresAtMs: now + 30 * 60_000,
      leaseTask: task ?? FieldValue.delete() }, { merge: true });
    return {checkpoint:data};
  });
}

export async function releaseMaintenanceLease(ref: DocumentReference, owner: string) {
  await ref.firestore.runTransaction(async tx => {
    if ((await tx.get(ref)).get("leaseOwner") === owner) {
      tx.set(ref, { leaseOwner: FieldValue.delete(), leaseExpiresAtMs: FieldValue.delete(), leaseTask: FieldValue.delete() }, { merge: true });
    }
  });
}
