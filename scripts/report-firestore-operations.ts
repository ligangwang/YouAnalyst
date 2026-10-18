// Export Cloud Logging entries with jsonPayload.event="firestore_operation" and explicit
// timestamp bounds. Supply the complete JSON array or JSONL export; do not use a
// truncated console sample. This report performs no Firestore or other cloud requests.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type Entry = Record<string, unknown>;
export function summarizeFirestoreOperations(entries: Entry[]) {
  const groups = new Map<string, { job: string; queryId: string; collection: string; operation: string; caller: string;
    queryShape: string; calls: number; errors: number; documentsReturned: number; missingDocuments: number;
    documentsWritten: number; maxDocumentsReturned: number; retryDocumentsReturned: number;
    emptyReads: number; durationMs: number; unknownReadCostCalls: number }>();
  for (const envelope of entries) {
    const row = (envelope.jsonPayload ?? envelope) as Entry;
    if (row.event !== 'firestore_operation') continue;
    const key = JSON.stringify([row.job, row.queryId]);
    let group = groups.get(key);
    if (!group) {
      group = { job: String(row.job), queryId: String(row.queryId), collection: String(row.collection),
        operation: String(row.operation), caller: String(row.caller), queryShape: String(row.queryShape ?? ''),
        calls: 0, errors: 0, documentsReturned: 0, missingDocuments: 0, documentsWritten: 0,
        maxDocumentsReturned: 0, retryDocumentsReturned: 0, emptyReads: 0, durationMs: 0, unknownReadCostCalls: 0 };
      groups.set(key, group);
    }
    const returned = Number(row.documentsReturned ?? 0);
    group.calls++;
    group.errors += Number(row.status === 'error');
    group.documentsReturned += returned;
    group.missingDocuments += Number(row.documentsMissing ?? 0);
    group.documentsWritten += Number(row.documentsWritten ?? 0);
    group.maxDocumentsReturned = Math.max(group.maxDocumentsReturned, returned);
    if (Number(row.transactionAttempt ?? 1) > 1) group.retryDocumentsReturned += returned;
    if (row.documentsReturned === 0 && ['get', 'getAll'].includes(String(row.operation))) group.emptyReads++;
    if (row.operation === 'aggregate' || row.status === 'error') group.unknownReadCostCalls++;
    group.durationMs += Number(row.durationMs ?? 0);
  }
  return [...groups.values()].map(row => ({ ...row,
    averageDocumentsReturned: row.documentsReturned / row.calls,
  })).sort((a, b) => b.documentsReturned - a.documentsReturned || b.calls - a.calls);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npx tsx scripts/report-firestore-operations.ts <export.json|export.jsonl>');
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim();
  const entries = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const queries = summarizeFirestoreOperations(entries);
  console.log(JSON.stringify({
    note: 'Observed SDK results and acknowledged writes, not billing or index scans. Errors, aggregates, offsets, transport retries and empty queries need separate billing analysis. Export the complete time window; truncated logs undercount.',
    queries,
  }, null, 2));
  if (!queries.length) throw new Error('No firestore_operation entries found; verify deployment and export window');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
