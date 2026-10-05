import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateCompanyThemes } from '../scripts/migrate-company-themes';
import batch from '../data/robotics/company-memberships.json';
import type { KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import {migrateSpaceTheme} from '../scripts/migrate-space-theme';
import space from '../data/space/company-memberships.json';
import {decode as decodeValue} from '../scripts/migrate-company-themes';

test('Space live enrollment fences new identities and preserves existing themes in one idempotent commit',async()=>{
  const f=await fixture();
  for(const proposal of space.companies.filter(row=>!row.id.startsWith('ORG:'))){
    const name=`projects/test-project/databases/(default)/documents/companies/${proposal.id}`;
    f.rows.set(name,{name,fields:encode({name:proposal.expectedName,status:'DIRECTORY',themeIds:['ai'],themeMemberships:{ai:{status:'PUBLISHED',primarySector:'compute',reviewedAt:'2026-01-01'}},description:'Existing profile'}).mapValue!.fields,updateTime:'2026-10-04T00:00:00Z'});
  }
  const superseded='projects/test-project/databases/(default)/documents/companies/ORG:SPACEX';
  f.rows.set(superseded,{name:superseded,fields:encode({name:'SpaceX',status:'PUBLISHED',listingStatus:'UNKNOWN',themeIds:['space'],themeMemberships:{space:{status:'PUBLISHED',primarySector:'launch',reviewedAt:space.reviewedAt}}}).mapValue!.fields,updateTime:'2026-10-04T00:00:00Z'});
  const before=structuredClone(f.rows);let commits=0,duplicate=false;
  const request=async(url:string,method:'GET'|'POST'='GET',data?:unknown):Promise<unknown>=>{
    if(url.endsWith(':runQuery')){
      const body=data as {structuredQuery:{where:{fieldFilter:{field:{fieldPath:string}}}}};
      if(body.structuredQuery.where.fieldFilter.field.fieldPath!=='themeIds')return duplicate?[{document:[...f.rows.values()][0]}]:[];
      return [...f.rows.values()].filter(document=>document.name!==superseded).map(document=>({document}));
    }
    if(url.endsWith(':commit')){
      assert((await readdir(f.backupDir)).length>0,'Backup precedes commit');
      const writes=(data as {writes:{update:Document;updateMask?:{fieldPaths:string[]};currentDocument:{exists?:boolean;updateTime?:string}}[]}).writes;
      for(const write of writes){
        const existing=f.rows.get(write.update.name);
        if(existing){assert.equal(write.currentDocument.updateTime,existing.updateTime);assert.deepEqual(write.updateMask?.fieldPaths,write.update.name===superseded?['status','canonicalCompanyId','themeIds','themeMemberships']:['themeMemberships','themeIds']);}
        else{assert.equal(write.currentDocument.exists,false);assert(space.companies.some(row=>write.update.name.endsWith('/'+row.id)&&row.id.startsWith('ORG:')));}
      }
      for(const write of writes)f.rows.set(write.update.name,{...write.update,fields:{...f.rows.get(write.update.name)?.fields,...write.update.fields},updateTime:'2026-10-04T02:00:00Z'});
      commits++;return {};
    }
    return f.request(url,method,data);
  };
  duplicate=true;
  await assert.rejects(migrateSpaceTheme({project:'test-project',graph:f.ai,request,backupDir:f.backupDir,write:true}),/another canonical ID/);
  assert.equal(commits,0);assert.deepEqual(f.rows,before);duplicate=false;
  const preview=await migrateSpaceTheme({project:'test-project',graph:f.ai,request,backupDir:f.backupDir});
  assert.equal(preview.changedCompanies,31);assert.equal(commits,0);
  const written=await migrateSpaceTheme({project:'test-project',graph:f.ai,request,backupDir:f.backupDir,write:true});
  assert.equal(written.newProfiles?.length,space.companies.filter(row=>row.id.startsWith('ORG:')).length);assert.equal(commits,1);
  assert.deepEqual(written.retiredProfiles,['ORG:SPACEX']);
  for(const [key,previous]of before){
    const next=f.rows.get(key)!;
    if(key===superseded){assert.equal(decodeValue(next.fields.status),'MERGED');assert.equal(decodeValue(next.fields.canonicalCompanyId),'US:SPCX');continue;}
    for(const [field,value]of Object.entries(previous.fields))if(!['themeIds','themeMemberships'].includes(field))assert.deepEqual(next.fields[field],value);
    if(previous.fields.themeMemberships)assert.deepEqual((decodeValue(next.fields.themeMemberships) as {ai:unknown}).ai,(decodeValue(previous.fields.themeMemberships) as {ai:unknown}).ai);
  }
  const again=await migrateSpaceTheme({project:'test-project',graph:f.ai,request,backupDir:f.backupDir,write:true});
  assert.equal(again.changedCompanies,0);assert.equal(commits,1);
});

type Value = { stringValue?: string; mapValue?: { fields: Record<string, Value> }; arrayValue?: { values: Value[] }; integerValue?: string };
type Document = { name: string; fields: Record<string, Value>; updateTime: string };
const encode = (data: unknown): Value => typeof data === 'object' ? Array.isArray(data) ? { arrayValue: { values: data.map(encode) } } : { mapValue: { fields: Object.fromEntries(Object.entries(data as object).map(([key, value]) => [key, encode(value)])) } } : { stringValue: String(data) };
async function fixture() {
  const root = 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents';
  const name = (id: string) => `${root.replace('https://firestore.googleapis.com/v1/', '')}/companies/${id}`;
  const ai: KnowledgeGraph = { nodes: Array.from({ length: 134 }, (_, i) => ({ id: i === 0 ? 'US:NVDA' : i === 1 ? 'ORG:SAMSUNG-ELECTRONICS' : `US:AI${i}`, kind: 'COMPANY', name: `Company ${i}`, order: i, stageIds: ['compute'] })), relationships: [], sources: [], asOf: '2026-10-04' };
  const rows = new Map<string, Document>();
  for (const node of ai.nodes.filter(node => node.id !== 'ORG:SAMSUNG-ELECTRONICS')) rows.set(name(node.id), { name: name(node.id), fields: encode({ name: node.name, status: 'DIRECTORY', aiGraph: { status: 'PUBLISHED', stageIds: ['compute'] }, description: 'Preserve this text', financials: { period: '2026Q3' } }).mapValue!.fields, updateTime: '2026-10-04T00:00:00Z' });
  for (const proposal of batch.companies) {
    const existing = rows.get(name(proposal.id));
    if (existing) existing.fields.name = encode(proposal.expectedName);
    else rows.set(name(proposal.id), { name: name(proposal.id), fields: encode({ name: proposal.expectedName, status: 'DIRECTORY' }).mapValue!.fields, updateTime: '2026-10-04T00:00:00Z' });
  }
  const relationship: Document = { name: 'projects/test-project/databases/(default)/documents/company_relationships/existing', fields: encode({ source: 'US:NVDA', target: 'US:AI2', status: 'PUBLISHED', evidence: [{ url: 'https://example.com/source' }] }).mapValue!.fields, updateTime: '2026-10-04T00:00:00Z' };
  const originals = structuredClone(rows); const backupDir = await mkdtemp(join(tmpdir(), 'youanalyst-theme-migration-')); let conflict = false; let commits = 0;
  const request = async (url: string, method = 'GET', data?: unknown): Promise<unknown> => {
    if (url.endsWith('/company_relationships?pageSize=1000')) return { documents: [relationship] };
    if (url.endsWith('/company_relationships/existing')) return relationship;
    if (url.endsWith(':runQuery')) return [...rows.values()].filter(row => row.fields.themeIds?.arrayValue?.values.some(value => value.stringValue === 'ai')).map(document => ({ document }));
    if (url.endsWith(':commit') && method === 'POST') {
      assert.equal((await readdir(backupDir)).length, 1, 'Backup must exist before writing');
      const writes = (data as { writes: { update: Document; updateMask?: { fieldPaths: string[] }; currentDocument: { updateTime?: string; exists?: boolean } }[] }).writes;
      if (conflict) throw Error('Concurrent edit: precondition failed');
      // Validate all preconditions before applying any write, as Firestore commit does.
      for (const write of writes) {
        const existing = rows.get(write.update.name);
        if (existing) { assert.equal(write.currentDocument.updateTime, existing.updateTime); assert.deepEqual(write.updateMask?.fieldPaths, ['themeMemberships', 'themeIds']); }
        else { assert.equal(write.currentDocument.exists, false); assert(write.update.name.endsWith('/ORG:SAMSUNG-ELECTRONICS')); }
      }
      // Firestore map serialization can reorder keys recursively.
      const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
      for (const write of writes) rows.set(write.update.name, { ...write.update, fields: sorted({ ...rows.get(write.update.name)?.fields, ...write.update.fields }) as Document['fields'], updateTime: '2026-10-04T01:00:00Z' });
      commits++; return {};
    }
    return rows.get(decodeURIComponent(url.replace('https://firestore.googleapis.com/v1/', ''))) ?? null;
  };
  return { ai, rows, originals, request, backupDir, commits: () => commits, conflict: () => { conflict = true; } };
}

test('atomic live migration backs up first, preserves existing fields and relationships, and materializes only a reviewed missing AI profile', async () => {
  const f = await fixture();
  const result = await migrateCompanyThemes({ project: 'test-project', graph: f.ai, request: f.request, write: true, backupDir: f.backupDir, expectedAiCompanies: 134 });
  assert.equal(f.commits(), 1); assert.equal(result.aiCompanies, 134); assert.deepEqual(result.materializedEditorialProfiles, ['ORG:SAMSUNG-ELECTRONICS']);
  for (const [key, before] of f.originals) for (const [field, value] of Object.entries(before.fields)) assert.deepEqual(f.rows.get(key)!.fields[field], value);
  const again = await migrateCompanyThemes({ project: 'test-project', graph: f.ai, request: f.request, write: true, backupDir: f.backupDir, expectedAiCompanies: 134 });
  assert.equal(again.changedCompanies, 0); assert.equal(f.commits(), 1);
});

test('concurrent changes and unexpected AI counts stop migration without partial writes', async () => {
  const f = await fixture(); f.conflict();
  await assert.rejects(migrateCompanyThemes({ project: 'test-project', graph: f.ai, request: f.request, write: true, backupDir: f.backupDir, expectedAiCompanies: 134 }), /precondition failed/);
  assert.deepEqual(f.rows, f.originals); assert.equal(f.commits(), 0);
  await assert.rejects(migrateCompanyThemes({ project: 'test-project', graph: { ...f.ai, nodes: f.ai.nodes.slice(1) }, request: f.request, write: true, backupDir: f.backupDir, expectedAiCompanies: 134 }), /AI map count changed/);
});
