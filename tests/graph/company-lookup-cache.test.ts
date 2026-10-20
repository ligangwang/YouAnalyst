import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore, Query } from 'firebase-admin/firestore';
import { readCompanyLookup } from '../../src/lib/company-lookup-cache';
import { lookupCompanyRoute } from '../../src/lib/market-companies/slug-lookup';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const listeners = new Set<{ key: string; emit: () => void }>();
  let opens = 0;
  const doc = (id: string) => ({ id, exists: rows.has(id), data: () => rows.get(id) });
  function source(key: string, snapshot: () => unknown) {
    return {
      key, isEqual: (other: { key: string }) => other.key === key,
      get: async () => { throw Error('unexpected direct read'); },
      onSnapshot: (next: (value: unknown) => void) => {
        opens++;
        const entry = { key, emit: () => next(snapshot()) };
        listeners.add(entry); queueMicrotask(entry.emit);
        return () => { listeners.delete(entry); };
      },
    };
  }
  const db = { collection: () => ({
    doc: (id: string) => source(id, () => doc(id)),
    where: (field: string, op: string, value: string) => ({
      limit: (limit: number) => source(`${field}:${op}:${value}:${limit}`, () => ({
        docs: [...rows].filter(([, data]) => data[field] === value).slice(0, limit).map(([id]) => doc(id)),
      })),
    }),
  }) } as unknown as Firestore;
  return { db, rows, opens: () => opens, push: () => { for (const entry of listeners) entry.emit(); } };
}

test('company routes share document subscriptions across requests and receive renames', async t => {
  t.after(closeLocalCaches);
  const f = fixture();
  f.rows.set('US:MU', { slug: 'micron' });
  await Promise.all(Array.from({ length: 20 }, () => lookupCompanyRoute('US:MU', f.db)));
  assert.equal(f.opens(), 1);
  f.rows.set('US:MU', { slug: 'micron-new' }); f.push();
  assert.equal((await lookupCompanyRoute('US:MU', f.db))?.path, '/company/micron-new');
  f.rows.delete('US:MU'); f.push();
  assert.equal((await lookupCompanyRoute('US:MU', f.db))?.data, undefined);
  assert.equal(f.opens(), 1);
});

test('ticker query caches empty matches and applies creations and deletions', async t => {
  t.after(closeLocalCaches);
  const f = fixture();
  const query = () => f.db.collection('companies').where('symbol', '==', 'NEW').limit(20) as Query;
  assert.equal((await readCompanyLookup(f.db, query())).docs.length, 0);
  assert.equal((await readCompanyLookup(f.db, query())).docs.length, 0);
  f.rows.set('US:NEW', { symbol: 'NEW', name: 'New' }); f.push();
  assert.equal((await readCompanyLookup(f.db, query())).docs[0].id, 'US:NEW');
  f.rows.delete('US:NEW'); f.push();
  assert.equal((await readCompanyLookup(f.db, query())).docs.length, 0);
  assert.equal(f.opens(), 1);
});
