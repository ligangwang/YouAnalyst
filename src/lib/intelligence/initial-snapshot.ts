// Rendering has a shorter budget than the shared data read. A slow read keeps
// warming the service cache for the browser API request without holding HTML open.
export const INITIAL_SNAPSHOT_BUDGET_MS = 1500;
export function initialSnapshotWithinBudget<T>(request: Promise<T>, budgetMs = INITIAL_SNAPSHOT_BUDGET_MS): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), budgetMs);
    request.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}
