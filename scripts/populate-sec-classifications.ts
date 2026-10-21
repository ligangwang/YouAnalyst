import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {FieldPath, FieldValue, getFirestore} from 'firebase-admin/firestore';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {periodicWebsiteMigrationGuard} from './firestore/website-migration-guard';
import {secRequest} from '../src/lib/sec-request';
import {parseSecTickerMapping} from '../src/lib/sec-filings/source';
import {buildSecCatalog, parseSecClassification, secCompanySyncPatch, normalizedCik} from '../src/lib/industry-classification/sec';
import type {ClassificationEntry} from '../src/lib/industry-classification/model';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--after=') && !arg.startsWith('--output='))) throw Error('Unknown argument');
  const projectId = process.env.GCP_PROJECT_ID, userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!projectId || !userAgent) throw Error('GCP_PROJECT_ID and SEC_USER_AGENT are required');
  const after = args.find(arg => arg.startsWith('--after='))?.slice(8) ?? '';
  if (after && !/^US:[A-Z0-9.\-]+$/.test(after)) throw Error('Invalid company cursor');
  const output = resolve(args.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'artifacts/sic-classification');
  const apply = args.includes('--apply');
  initializeApp({credential: applicationDefault(), projectId});
  const db = getFirestore();
  let query = db.collection('companies').orderBy(FieldPath.documentId()).startAt('US:').endBefore('US;').limit(100);
  if (after) query = query.startAfter(after);
  const page = await query.get();
  if (page.empty) { console.log(JSON.stringify({complete: true, scanned: 0})); return; }
  const json = (url: string) => secRequest(url, {headers: {'user-agent': userAgent, accept: 'application/json'}}, r => r.json(), {operation: 'sic_classification_backfill'});
  // A single mapping request, one submissions request per distinct issuer per page.
  const mapping = parseSecTickerMapping(await json('https://www.sec.gov/files/company_tickers_exchange.json'));
  const cache = new Map<string, ClassificationEntry | null>();
  const candidates: {doc: typeof page.docs[number]; cik: string; entry: ClassificationEntry | null}[] = [];
  const skipped: {id: string; reason: string}[] = [];
  for (const doc of page.docs) {
    if (doc.get('isDeleted') === true) { skipped.push({id: doc.id, reason: 'soft_deleted'}); continue; }
    const mapped = mapping.get(doc.id.slice(3).replace(/-/g, '.'));
    const storedCik = normalizedCik(doc.get('cik'));
    if (storedCik && mapped && storedCik !== mapped) { skipped.push({id: doc.id, reason: 'cik_conflict'}); continue; }
    const cik = storedCik ?? mapped;
    if (!cik) { skipped.push({id: doc.id, reason: 'no_sec_ticker_mapping'}); continue; }
    if (!cache.has(cik)) {
      await delay(1000);
      cache.set(cik, parseSecClassification(await json(`https://data.sec.gov/submissions/CIK${cik}.json`), cik));
    }
    const entry = cache.get(cik) ?? null;
    candidates.push({doc, cik, entry});
  }
  await mkdir(output, {recursive: true});
  const entries = candidates.flatMap(c => c.entry ? [c.entry] : []);
  const catalog = entries.length ? buildSecCatalog(entries) : null;
  if (catalog) await writeFile(join(output, `${catalog.version}.json`), JSON.stringify(catalog, null, 2) + '\n');
  const observedAt = new Date().toISOString();
  const changes = candidates.flatMap(({doc, cik, entry}) => {
    const patch = secCompanySyncPatch(doc.data(), cik, entry, catalog?.version ?? '', observedAt);
    return patch ? [{doc, patch}] : [];
  });
  const report = {projectId, apply, observedAt, scanned: page.size, changed: changes.length, skipped,
    after: page.docs.at(-1)!.id, complete: page.size < 100,
    changes: changes.map(({doc, patch}) => ({id: doc.id, patch}))};
  // Save a reviewable plan before any company mutation. Global SEC rate-gate writes
  // still occur in dry-run mode, because requests must respect the shared gate.
  const reportPath = join(output, `batch-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  let applied = 0;
  const guard=apply?await periodicWebsiteMigrationGuard(projectId,process.env.MIGRATION_COMPATIBLE_REVISION):undefined;
  if(guard)await guard(true);
  for (const {doc, patch} of changes) {
    if (!apply) break;
    await guard!();
    // Fail closed on concurrent changes, including soft deletes. Never recreate.
    await doc.ref.update({...patch, updatedAt: FieldValue.serverTimestamp()}, {lastUpdateTime: doc.updateTime});
    applied++;
    await delay(1000);
  }
  if(guard)await guard(true);
  console.log(JSON.stringify({...report, changes: undefined, applied, reportPath}));
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'SIC population failed'); process.exitCode = 1;});
