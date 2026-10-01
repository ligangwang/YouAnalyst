import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const requireValue = (ok) => { if (!ok) throw new Error('NVDA baseline safety check failed; configuration was not printed.'); };
function environment(container, name) {
  const matches = container?.env?.filter(item => item.name === name) ?? [];
  requireValue(matches.length === 1 && typeof matches[0].value === 'string');
  return matches[0].value;
}
function checkTask(execution, expected, flag) {
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
  requireValue(environment(container, 'SEC_FILINGS_COLLECTOR_ENABLED') === flag);
  return container;
}
export function checkCollector(value, expected) {
  checkTask(value?.spec?.template?.spec, expected, "0");
  return true;
}
export function checkGraphDisabled(value) {
  const containers = value?.spec?.template?.spec?.containers;
  requireValue(containers?.length === 1 && environment(containers[0], 'COMPANY_GRAPH_PROCESSING_ENABLED') === '0');
  return true;
}
export function checkExecution(value, expected) {
  const container = checkTask(value?.spec, expected, '1');
  requireValue(JSON.stringify(container.args) === '["dist/collect-sec-filings.cjs","--apply","--baseline-only","--company=NVDA"]');
  requireValue(/^collect-sec-filings-production-[a-z0-9]+$/.test(expected.execution)
    && value?.metadata?.name === expected.execution);
  const status = value.status;
  requireValue(status?.conditions?.some(row => row.type === 'Completed' && row.status === 'True'));
  requireValue(status.succeededCount === 1 && (status.failedCount ?? 0) === 0
    && (status.cancelledCount ?? 0) === 0 && (status.runningCount ?? 0) === 0);
  requireValue(Number.isSafeInteger(status.retriedCount ?? 0) && (status.retriedCount ?? 0) >= 0 && (status.retriedCount ?? 0) <= 1);
  requireValue(Number.isFinite(Date.parse(status.startTime)) && Number.isFinite(Date.parse(status.completionTime))
    && Date.parse(status.startTime) <= Date.parse(status.completionTime));
  return { execution: expected.execution, startTime: status.startTime, completionTime: status.completionTime,
    succeededCount: 1, retriedCount: status.retriedCount ?? 0, commit: expected.commit, image: expected.image };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const value = JSON.parse(readFileSync(0, 'utf8'));
    if (process.argv[2] === 'collector') checkCollector(value, { project: process.env.GCP_PROJECT_ID,
      commit: process.env.APPROVED_WORKER_COMMIT, image: process.env.EXPECTED_IMAGE });
    else if (process.argv[2] === 'graph') checkGraphDisabled(value);
    else if (process.argv[2] === 'execution') {
      console.log(JSON.stringify(checkExecution(value, { project: process.env.GCP_PROJECT_ID,
        commit: process.env.APPROVED_WORKER_COMMIT, image: process.env.EXPECTED_IMAGE, execution: process.env.EXPECTED_EXECUTION })));
    } else throw new Error();
  } catch {
    console.error('NVDA baseline safety check failed; configuration was not printed.');
    process.exitCode = 1;
  }
}
