import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFirestoreOperations } from '../scripts/report-firestore-operations';

test('report ranks repeated reads and isolates retries, failures, writes and aggregates', () => {
  const base = { event: 'firestore_operation', job: 'sec', status: 'success', collection: 'companies' };
  const rows = summarizeFirestoreOperations([
    { jsonPayload: { ...base, queryId: 'a', operation: 'get', documentsReturned: 100 } },
    { ...base, queryId: 'b', operation: 'get', documentsReturned: 75 },
    { ...base, queryId: 'b', operation: 'get', documentsReturned: 75, transactionAttempt: 2 },
    { ...base, queryId: 'c', operation: 'set', documentsWritten: 3 },
    { ...base, queryId: 'd', operation: 'get', status: 'error' },
    { ...base, queryId: 'e', operation: 'aggregate', documentsReturned: 0 },
    { ...base, queryId: 'f', operation: 'get', documentsReturned: 0, documentsMissing: 1 },
    { event: 'unrelated', documentsReturned: 9999 },
  ]);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].queryId, 'b');
  assert.equal(rows[0].documentsReturned, 150);
  assert.equal(rows[0].retryDocumentsReturned, 75);
  assert.equal(rows[0].averageDocumentsReturned, 75);
  assert.equal(rows.find(row => row.queryId === 'c')?.documentsWritten, 3);
  assert.equal(rows.find(row => row.queryId === 'd')?.errors, 1);
  assert.equal(rows.find(row => row.queryId === 'e')?.unknownReadCostCalls, 1);
  assert.equal(rows.find(row => row.queryId === 'f')?.missingDocuments, 1);
});
