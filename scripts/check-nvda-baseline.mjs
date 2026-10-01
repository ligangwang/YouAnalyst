import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const requireValue = (ok) => { if (!ok) throw new Error('NVDA baseline safety check failed; configuration was not printed.'); };
function environment(container, name) {
  const matches = container?.env?.filter(item => item.name === name) ?? [];
  requireValue(matches.length === 1 && typeof matches[0].value === 'string');
  return matches[0].value;
}
export function checkCollector(value, expected) {
  const execution = value?.spec?.template?.spec;
  const task = execution?.template?.spec;
  requireValue(execution?.taskCount === 1 && execution.parallelism === 1);
  requireValue(task?.containers?.length === 1 && Number.isSafeInteger(task.maxRetries) && task.maxRetries <= 1 && task.maxRetries >= 0);
  requireValue(Number(task.timeoutSeconds) > 0 && Number(task.timeoutSeconds) <= 1200);
  requireValue(task.serviceAccountName === `directory-sync-runtime@${expected.project}.iam.gserviceaccount.com`);
  const container = task.containers[0];
  requireValue(/@sha256:[a-f0-9]{64}$/.test(expected.image) && container.image === expected.image);
  requireValue(JSON.stringify(container.command) === '["node"]');
  requireValue(environment(container, 'GCP_PROJECT_ID') === expected.project);
  requireValue(environment(container, 'GIT_SHA') === expected.commit);
  requireValue(environment(container, 'SEC_FILINGS_COLLECTOR_ENABLED') === '0');
  return true;
}
export function checkGraphDisabled(value) {
  const containers = value?.spec?.template?.spec?.containers;
  requireValue(containers?.length === 1 && environment(containers[0], 'COMPANY_GRAPH_PROCESSING_ENABLED') === '0');
  return true;
}
export function canarySummary(entries) {
  requireValue(Array.isArray(entries));
  const payloads = entries.map(row => row.jsonPayload).filter(row => row?.event === 'run_completed' || row?.message === 'collect-sec-filings: run_completed');
  if (!payloads.length) return null;
  const row = payloads[0];
  requireValue(row.companyId === 'NVDA' && row.mode === 'baseline-only' && row.published === 0);
  requireValue(['completed', 'already-completed'].includes(row.status));
  for (const key of ['baselined', 'existing', 'snapshotFilings']) requireValue(Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 2000);
  requireValue(row.baselined + row.existing <= row.snapshotFilings);
  return { companyId: 'NVDA', mode: 'baseline-only', status: row.status, baselined: row.baselined,
    existing: row.existing, snapshotFilings: row.snapshotFilings, published: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const value = JSON.parse(readFileSync(0, 'utf8'));
    if (process.argv[2] === 'collector') checkCollector(value, { project: process.env.GCP_PROJECT_ID,
      commit: process.env.APPROVED_WORKER_COMMIT, image: process.env.EXPECTED_IMAGE });
    else if (process.argv[2] === 'graph') checkGraphDisabled(value);
    else if (process.argv[2] === 'summary') {
      const result = canarySummary(value);
      if (result) console.log(JSON.stringify(result));
      else process.exitCode = 2; // Logs can arrive after execution completion.
    } else throw new Error();
  } catch {
    console.error('NVDA baseline safety check failed; configuration was not printed.');
    process.exitCode = 1;
  }
}
