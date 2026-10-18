import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { changeCached, CHANGE_CACHE_DOCUMENT } from '../../src/lib/change-cache';
import { loadThemeEnrolledCompanies } from '../../src/lib/knowledge-graph/company-cache';

test('graph rebuilds reuse enrolled companies until company changes, including unenrollment', async () => {
  const state = { enabled: true, versions: {} as Record<string, string> };
  let reads = 0, fail = false;
  let ids = ['relationship-1'];
  const db = { collection(name: string) {
    if (name === 'collectors') return { doc(id: string) {
      assert.equal(id, CHANGE_CACHE_DOCUMENT);
      return { get: async () => ({ data: () => structuredClone(state) }) };
    } };
    assert.equal(name, 'companies');
    return { where(field: string, operator: string, value: string[]) {
      assert.deepEqual([field, operator, value], ['themeIds', 'array-contains-any', ['ai', 'robotics', 'space']]);
      return { get: async () => {
        reads++;
        if (fail) throw new Error('unavailable');
        return { docs: ids.map(id => ({ id })) };
      } };
    } };
  } } as unknown as Firestore;
  const graph = () => changeCached(db, 'test-graph',
    ['companies', 'company_relationships', 'company_fundamentals'], () => loadThemeEnrolledCompanies(db));
  await Promise.all([graph(), graph()]);
  assert.equal(reads, 1);
  for (const collection of ['company_fundamentals', 'company_relationships']) {
    state.versions[collection] = 'changed';
    assert.equal((await graph()).docs.length, 1);
  }
  assert.equal(reads, 1, 'unrelated graph invalidations must not reread companies');
  ids = [];
  state.versions.companies = 'deleted';
  assert.equal((await graph()).docs.length, 0);
  assert.equal(reads, 2);
  state.versions.companies = 'updated';
  fail = true;
  await assert.rejects(graph(), /unavailable/);
  fail = false;
  ids = ['relationship-2'];
  assert.equal((await graph()).docs[0].id, 'relationship-2');
  assert.equal(reads, 4, 'failed reads must be retried');
  state.enabled = false;
  await graph();
  await graph();
  assert.equal(reads, 6, 'disabled change delivery must bypass caching');
});
