import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import batch from '../data/robotics/company-memberships.json';
import type { KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import type { ThemedCompany } from '../src/lib/company-themes/model';
import { planCompanyThemeMigration } from '../src/lib/company-themes/migration';
import { NVIDIA_EDITORIAL_COMPANIES } from '../src/lib/research/nvidia-manufacturing';

type Value = { mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] }; stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; nullValue?: null; timestampValue?: string };
type Document = { name: string; fields: Record<string, Value>; updateTime: string };
type Request = (url: string, method?: 'GET' | 'POST', data?: unknown) => Promise<unknown>;
const decode = (value: Value): unknown => value.mapValue ? Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]))
  : value.arrayValue ? (value.arrayValue.values ?? []).map(decode)
  : value.integerValue !== undefined ? Number(value.integerValue) : Object.values(value)[0];
const encode = (value: unknown): Value => value === null ? { nullValue: null }
  : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value as object).map(([key, item]) => [key, encode(item)])) } }
  : typeof value === 'number' ? Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  : typeof value === 'boolean' ? { booleanValue: value } : { stringValue: String(value) };
const company = (document: Document): ThemedCompany => ({ ...Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decode(value)])), id: document.name.split('/').at(-1)! });

/** Atomic, additive migration. The backup completes before any production write. */
export async function migrateCompanyThemes(options: { project: string; graph: KnowledgeGraph; request: Request; write: boolean; backupDir: string; expectedAiCompanies: number }) {
  assert(/^[a-z][a-z0-9-]+$/.test(options.project), 'Invalid project');
  const root = `https://firestore.googleapis.com/v1/projects/${options.project}/databases/(default)/documents`;
  const aiIds = options.graph.nodes.filter(node => node.kind === 'COMPANY').map(node => node.id);
  assert(aiIds.length === options.expectedAiCompanies && new Set(aiIds).size === aiIds.length, 'AI map count changed; review the snapshot before migrating');
  const ids = [...new Set([...aiIds, ...batch.companies.map(row => row.id)])];
  const documents: Document[] = [];
  const missingIds: string[] = [];
  for (let start = 0; start < ids.length; start += 20) {
    const rows = await Promise.all(ids.slice(start, start + 20).map(async id => ({ id, document: await options.request(`${root}/companies/${encodeURIComponent(id)}`) as Document | null })));
    for (const row of rows) {
      if (row.document) documents.push(row.document);
      else {
        assert(aiIds.includes(row.id) && NVIDIA_EDITORIAL_COMPANIES.some(company => company.id === row.id), `${row.id}: missing company has no reviewed existing AI profile`);
        missingIds.push(row.id);
      }
    }
  }
  const records = [...documents.map(company), ...NVIDIA_EDITORIAL_COMPANIES.filter(row => missingIds.includes(row.id))] as ThemedCompany[];
  const patches = planCompanyThemeMigration(records, options.graph, batch);
  assert(patches.length <= 500, 'Migration exceeds one atomic commit');
  // Include raw relationships in the backup. The migration never writes them.
  const relationships: Document[] = [];
  let pageToken = '';
  do {
    const page = await options.request(`${root}/company_relationships?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`) as { documents?: Document[]; nextPageToken?: string };
    relationships.push(...page.documents ?? []); pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  await mkdir(options.backupDir, { recursive: true });
  const backup = resolve(options.backupDir, `company-themes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(backup, JSON.stringify({ project: options.project, graph: options.graph, documents, missingIds, relationships, patches }, null, 2), { flag: 'wx' });
  const byId = new Map(documents.map(document => [company(document).id, document]));
  if (options.write && patches.length) {
    await options.request(`${root}:commit`, 'POST', { writes: patches.map(patch => {
      const existing = byId.get(patch.id);
      const fields = { themeMemberships: encode(patch.themeMemberships), themeIds: encode(patch.themeIds) };
      if (existing) return { update: { name: existing.name, fields }, updateMask: { fieldPaths: ['themeMemberships', 'themeIds'] }, currentDocument: { updateTime: existing.updateTime } };
      const reviewed = NVIDIA_EDITORIAL_COMPANIES.find(company => company.id === patch.id)!;
      return { update: { name: `${root.replace('https://firestore.googleapis.com/v1/', '')}/companies/${patch.id}`, fields: { ...encode(reviewed).mapValue!.fields, ...fields } }, currentDocument: { exists: false } };
    }) });
    const after: Document[] = [];
    for (let start = 0; start < ids.length; start += 20) after.push(...await Promise.all(ids.slice(start, start + 20).map(id => options.request(`${root}/companies/${encodeURIComponent(id)}`) as Promise<Document>)));
    assert.equal(planCompanyThemeMigration(after.map(company), options.graph, batch).length, 0, 'Membership verification failed');
    for (const before of documents) {
      const next = after.find(doc => doc.name === before.name)!;
      for (const key of ['aiGraph', 'inGraph']) assert.deepEqual(next.fields[key], before.fields[key], `${before.name}: existing AI graph metadata changed`);
    }
    const current = await options.request(`${root}:runQuery`, 'POST', { structuredQuery: { from: [{ collectionId: 'companies' }], where: { fieldFilter: { field: { fieldPath: 'themeIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: 'ai' } } } } }) as { document?: Document }[];
    const enrolled = new Set(current.flatMap(row => row.document ? [company(row.document).id] : []));
    assert(aiIds.every(id => enrolled.has(id)), 'An existing AI company lost its membership');
    for (let start = 0; start < relationships.length; start += 20) await Promise.all(relationships.slice(start, start + 20).map(async previous => {
      const next = await options.request(`https://firestore.googleapis.com/v1/${previous.name}`) as Document;
      assert.deepEqual(next.fields, previous.fields, `${previous.name}: relationship changed during migration; inspect concurrent updates`);
    }));
  }
  return { mode: options.write ? 'written' : 'preview', backup, aiCompanies: aiIds.length, roboticsCompanies: batch.companies.length, uniqueCompanies: ids.length, changedCompanies: patches.length, materializedEditorialProfiles: missingIds, preservedRelationshipDocuments: relationships.length };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/migrate-company-themes.ts')) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  assert(project, 'Set GOOGLE_CLOUD_PROJECT explicitly');
  const graphFile = process.argv.find(arg => arg.startsWith('--graph='))?.slice(8);
  assert(graphFile, 'Supply a freshly reviewed AI snapshot with --graph=path');
  import('node:fs/promises').then(async ({ readFile }) => {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
    const client = await auth.getClient();
    const request: Request = async (url, method = 'GET', data) => {
      const response = await client.request({ url, method, data, validateStatus: status => status >= 200 && status < 300 || method === 'GET' && status === 404 });
      return response.status === 404 ? null : response.data;
    };
    console.log(JSON.stringify(await migrateCompanyThemes({ project, graph: JSON.parse(await readFile(graphFile, 'utf8')), request, write: process.argv.includes('--write'), backupDir: 'output/company-theme-backups', expectedAiCompanies: 134 })));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
