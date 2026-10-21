import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {FieldValue, Timestamp, getFirestore} from 'firebase-admin/firestore';
import {readFile, writeFile, appendFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildSecCatalog, indexSecBulk, secCompanySyncPatch, normalizedCik, type SecCompanyPatch} from '../src/lib/industry-classification/sec';

type SnapshotRow = {id: string; data: Record<string, unknown>; updateTime: {seconds: number; nanoseconds: number}};
type PlanRow = {id: string; updateTime: SnapshotRow['updateTime']; patch: SecCompanyPatch};

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !a.startsWith('--directory=') && a !== '--apply' && !a.startsWith('--limit=') && !a.startsWith('--delay-ms=') && !a.startsWith('--batch-size='))) throw Error('Unknown argument');
  const directory = resolve(args.find(a => a.startsWith('--directory='))?.slice(12) ?? 'artifacts/sic-classification');
  if (!process.env.GCP_PROJECT_ID) throw Error('GCP_PROJECT_ID required');
  const planPath = join(directory, 'plan.json');
  if (!args.includes('--apply')) {
    const snapshot: SnapshotRow[] = JSON.parse(await readFile(join(directory, 'companies.json'), 'utf8'));
    const {issuers, tickers, ambiguous} = indexSecBulk(JSON.parse(await readFile(join(directory, 'sec-issuers.json'), 'utf8')));
    const catalog = buildSecCatalog([...issuers.values()].filter(entry => entry !== null));
    await writeFile(join(directory, `${catalog.version}.json`), JSON.stringify(catalog, null, 2) + '\n');
    const observedAt = new Date().toISOString(), changes: PlanRow[] = [], skipped: {id: string; reason: string}[] = [];
    const ids = new Set<string>();
    for (const row of snapshot) {
      if (!/^US:[A-Z0-9.\-]+$/.test(row.id) || ids.has(row.id)) throw Error('Invalid/duplicate company identity');
      ids.add(row.id);
      const skip = (reason: string) => skipped.push({id: row.id, reason});
      if (row.data.isDeleted === true) {skip('soft_deleted'); continue;}
      const ticker = row.id.slice(3).replace(/-/g, '.');
      if (ambiguous.has(ticker)) {skip('ambiguous_sec_ticker'); continue;}
      let stored: string | undefined;
      try { stored = normalizedCik(row.data.cik); } catch {skip('invalid_stored_cik'); continue;}
      const mapped = tickers.get(ticker);
      if (stored && mapped && stored !== mapped) {skip('cik_conflict'); continue;}
      const cik = stored ?? mapped;
      if (!cik) {skip('no_sec_ticker_mapping'); continue;}
      if (!issuers.has(cik)) {skip('sec_issuer_unavailable'); continue;}
      const entry = issuers.get(cik) ?? null;
      const patch = secCompanySyncPatch(row.data, cik, entry, catalog.version, observedAt);
      if (patch) changes.push({id: row.id, updateTime: row.updateTime, patch});
      else skip('unchanged');
    }
    const plan = {projectId: process.env.GCP_PROJECT_ID, observedAt, scanned: snapshot.length, catalogVersion: catalog.version, changes, skipped};
    await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({...plan, changes: changes.length, skipped: skipped.reduce<Record<string, number>>((a, r) => {a[r.reason] = (a[r.reason] ?? 0) + 1; return a;}, {})}));
    return;
  }
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as {projectId: string; changes: PlanRow[]};
  if (plan.projectId !== process.env.GCP_PROJECT_ID) throw Error('Plan project mismatch');
  const limit = Number(args.find(a => a.startsWith('--limit='))?.slice(8) ?? 100);
  const delayMs = Number(args.find(a => a.startsWith('--delay-ms='))?.slice(11) ?? 1000);
  const batchSize = Number(args.find(a => a.startsWith('--batch-size='))?.slice(13) ?? 1);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20000 || !Number.isInteger(delayMs) || delayMs < 100 || delayMs > 60000
    || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10 || (batchSize > 1 && delayMs < 1000)) throw Error('Invalid batch bounds');
  const resultPath = join(directory, 'applied.jsonl');
  const prior = await readFile(resultPath, 'utf8').catch((error: NodeJS.ErrnoException) => {if (error.code === 'ENOENT') return ''; throw error;});
  const finished = new Set(prior.split('\n').filter(Boolean).map(line => JSON.parse(line).id));
  initializeApp({credential: applicationDefault(), projectId: plan.projectId});
  const db = getFirestore(); let processed = 0, applied = 0, conflicts = 0;
  const pending = plan.changes.filter(row => !finished.has(row.id)).slice(0, limit);
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const group = pending.slice(offset, offset + batchSize);
    for (const row of group) if (!/^US:[A-Z0-9.\-]+$/.test(row.id) || (row.patch.taxonomy && row.patch.taxonomy !== 'SIC')
      || (row.patch.cik !== undefined && !/^\d{10}$/.test(row.patch.cik)) || !Object.keys(row.patch).length) throw Error('Invalid plan row');
    const statuses = new Map(group.map(row => [row.id, 'applied']));
    const batch = db.batch();
    for (const row of group) batch.update(db.collection('companies').doc(row.id), {...row.patch, updatedAt: FieldValue.serverTimestamp()},
      {lastUpdateTime: new Timestamp(row.updateTime.seconds, row.updateTime.nanoseconds)});
    try {
      await batch.commit();
    } catch (error) {
      const code = (error as {code?: number}).code;
      if (code !== 9 && code !== 5) throw error;
      // A rejected batch is atomic. Isolate concurrent edits without dropping
      // unrelated companies from the group, retaining every precondition.
      for (const row of group) {
        try {
          await db.collection('companies').doc(row.id).update({...row.patch, updatedAt: FieldValue.serverTimestamp()},
            {lastUpdateTime: new Timestamp(row.updateTime.seconds, row.updateTime.nanoseconds)});
        } catch (cause) {
          if (![9, 5].includes((cause as {code: number}).code)) throw cause;
          statuses.set(row.id, 'conflict');
        }
        await delay(1000);
      }
    }
    await appendFile(resultPath, group.map(row => JSON.stringify({id: row.id, status: statuses.get(row.id), at: new Date().toISOString()})).join('\n') + '\n');
    for (const status of statuses.values()) {if (status === 'applied') applied++; else conflicts++;}
    processed += group.length;
    if (processed % 100 === 0) console.log(JSON.stringify({processed, applied, conflicts, remaining: plan.changes.length - finished.size - processed}));
    await delay(delayMs);
  }
  console.log(JSON.stringify({processed, applied, conflicts, remaining: plan.changes.length - finished.size - processed}));
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'SEC bulk population failed'); process.exitCode = 1;});
