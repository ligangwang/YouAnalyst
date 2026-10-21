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


test('company lookup partition remains bounded and separate between database clients', async t => {
 t.after(closeLocalCaches);
 const a=fixture(),b=fixture();
 a.rows.set('US:ONE',{slug:'first'});b.rows.set('US:ONE',{slug:'second'});
 assert.equal((await lookupCompanyRoute('US:ONE',a.db))?.path,'/company/first');
 assert.equal((await lookupCompanyRoute('US:ONE',b.db))?.path,'/company/second');
 for(let i=0;i<1024;i++)await lookupCompanyRoute(`US:C${i}`,a.db);
 const before=a.opens();await lookupCompanyRoute('US:ONE',a.db);
 assert.equal(a.opens(),before+1,'idle sources are still evicted at the bounded capacity');
 assert.equal(b.opens(),1,'one client cannot evict another client sources');
});

test('soft deletion hides companies without physical removal and restoration returns them',async t=>{
 t.after(closeLocalCaches);const f=fixture();const ref=f.db.collection('companies').doc('US:A');
 const query=f.db.collection('companies').where('symbol','==','A').limit(20);
 f.rows.set('US:A',{name:'A',symbol:'A'});
 assert.equal((await readCompanyLookup(f.db,ref)).exists,true);
 await readCompanyLookup(f.db,query);
 f.rows.set('US:A',{name:'A',symbol:'A',isDeleted:true});f.push();
 assert.equal((await readCompanyLookup(f.db,ref)).exists,false);
 assert.equal((await readCompanyLookup(f.db,query)).docs.length,0);
 assert.equal(f.rows.has('US:A'),true);
 f.rows.set('US:A',{name:'A',symbol:'A',isDeleted:false});f.push();
 assert.equal((await readCompanyLookup(f.db,ref)).exists,true);
 assert.equal((await readCompanyLookup(f.db,query)).docs.length,1);
 assert.equal(f.opens(),2);
});
