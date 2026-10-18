import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';
import { exchangeRegion } from '../src/lib/market-companies/exchange-region';

/** Additive, restartable backfill. Never rename/delete documents or replace profiles. */
async function main() {
  const project = process.env.GCP_PROJECT_ID;
  assert(project === 'ifindata-80905', 'Explicit production project required');
  const apply = process.argv.includes('--apply');
  assert(apply !== process.argv.includes('--preview'), 'Choose --preview or --apply');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const root = `projects/${project}/databases/(default)/documents`;
  async function request(path: string, body: unknown) {
    const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? await auth.getAccessToken();
    const response = await fetch(`https://firestore.googleapis.com/v1/${root}:${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Firestore ${path} failed: HTTP ${response.status}`);
    return response.json();
  }
  type Document = {name: string; updateTime: string; fields?: Record<string, {stringValue?: string; nullValue?: unknown}>};
  const directory = `artifacts/exchange-region/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await mkdir(directory, { recursive: true });
  let cursor: string | undefined;
  let scanned = 0, changed = 0, page = 0;
  const unknown: string[] = [];
  for (;;) {
    const rows = await request('runQuery', { structuredQuery: {
      from: [{ collectionId: 'companies' }], select: {fields: [{fieldPath: 'exchange_region'}]},
      orderBy: [{field: {fieldPath: '__name__'}, direction: 'ASCENDING'}], limit: 25,
      ...(cursor ? {startAt: {values: [{referenceValue: cursor}], before: false}} : {}),
    } }) as {document?: Document}[];
    const docs = rows.flatMap(row => row.document ? [row.document] : []);
    if (!docs.length) break;
    const patches = docs.flatMap(doc => {
      const id = doc.name.split('/').at(-1)!;
      const value = exchangeRegion(id);
      if (value === null && !id.startsWith('ORG:')) { unknown.push(id); return []; }
      const previous = doc.fields?.exchange_region;
      const same = value === null ? previous && Object.hasOwn(previous, 'nullValue') : previous?.stringValue === value;
      return same ? [] : [{ doc, value }];
    });
    await writeFile(`${directory}/${page++}.json`, JSON.stringify(patches.map(({doc, value}) => ({
      name: doc.name, updateTime: doc.updateTime, previous: doc.fields?.exchange_region, next: value,
    })), null, 2), {flag: 'wx'});
    if (apply && patches.length) {
      // Company writes fan out through Eventarc to the website. Keep bursts small,
      // let invalidations drain, and fail closed if the live service is unhealthy.
      await new Promise(resolve => setTimeout(resolve, 5000));
      const health = await fetch('https://ifindata-web-zcgfwde4aa-uc.a.run.app/api/health', {signal: AbortSignal.timeout(15000)});
      assert.equal(health.status, 200, 'Stop backfill: live service is not healthy; completed batches remain safe to resume');
      await request('commit', {writes: patches.map(({doc, value}) => ({
        update: {name: doc.name, fields: {exchange_region: value === null ? {nullValue: null} : {stringValue: value}}},
        updateMask: {fieldPaths: ['exchange_region']}, currentDocument: {updateTime: doc.updateTime},
      }))});
      const verified = await request('batchGet', {documents: patches.map(({doc}) => doc.name), mask: {fieldPaths: ['exchange_region']}}) as {found?: Document}[];
      const byName = new Map(verified.flatMap(row => row.found ? [[row.found.name, row.found] as const] : []));
      for (const {doc, value} of patches) {
        const field = byName.get(doc.name)?.fields?.exchange_region;
        assert(field && (value === null ? Object.hasOwn(field, 'nullValue') : field.stringValue === value), `${doc.name}: verification failed`);
      }
    }
    scanned += docs.length; changed += patches.length; cursor = docs.at(-1)!.name;
    console.log(JSON.stringify({event: 'exchange_region_backfill_page', mode: apply ? 'apply' : 'preview',
      documentsRead: docs.length + (apply ? patches.length : 0), documentsWritten: apply ? patches.length : 0, scanned, changed}));
  }
  const result = {mode: apply ? 'applied' : 'preview', scanned, changed, unknown, directory};
  await writeFile(`${directory}/summary.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(unknown.length, 0, 'Unknown listing identities require review before switching readers');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
