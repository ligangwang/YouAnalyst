import { localDocuments } from '../local-cache/entities';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { changeCached, readCacheState, withCacheReadScope } from '../change-cache';
import { companyVersions, hasCompanyIndex, loadCompanyDocuments } from '../company-document-cache';
import type { CompanyChange } from '../company-change-index';

type Field = 'source' | 'target' | 'status' | 'themeIds';
type Store = {
  docs: Map<string, QueryDocumentSnapshot>;
  indexes: Record<Field, Map<string, Set<string>>>;
  versions: Record<string, CompanyChange>;
  generation: string;
  sortedIds: string[];
};
const stores = new WeakMap<Firestore, Promise<Store>>();
function build(docs: Map<string, QueryDocumentSnapshot>, versions: Store['versions'], generation: string): Store {
  const indexes: Store['indexes'] = {source:new Map(), target:new Map(), status:new Map(), themeIds:new Map()};
  for (const [id, doc] of docs) {
    const row = doc.data();
    for (const field of Object.keys(indexes) as Field[]) {
      const values = field === 'themeIds' ? (Array.isArray(row[field]) ? row[field] : []) : [row[field]];
      for (const value of values) {
        if (typeof value !== 'string') continue;
        const ids = indexes[field].get(value) ?? new Set<string>();
        ids.add(id); indexes[field].set(value, ids);
      }
    }
  }
  return {docs,indexes,versions,generation,sortedIds:[...docs.keys()].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))};
}
/** One all-status store per Firestore client/process; metadata coordinates processes.
 * Publish documents and indexes together only after a complete successful update.
 */
function loadStore(db: Firestore): Promise<Store> {
  return withCacheReadScope(async () => {
    const state = await readCacheState(db);
    if (!hasCompanyIndex(state, 'company_relationships')) {
      stores.delete(db);
      return changeCached(db, 'relationship-index', ['company_relationships'], async () =>
        build(new Map((await db.collection('company_relationships').get()).docs.map(doc => [doc.id,doc])), {}, 'legacy'));
    }
    const previous = stores.get(db);
    const next = (async () => {
      const old = await previous?.catch(() => undefined);
      const index = state.companyIndexes!.company_relationships;
      const versions = await companyVersions(db, 'company_relationships', state, Object.keys(index.shards));
      if (!old || old.generation !== index.generation) {
        return build(new Map((await db.collection('company_relationships').get()).docs.map(doc => [doc.id,doc])), versions,index.generation);
      }
      const ids = Object.entries(versions).filter(([key,value]) => old.versions[key]?.version !== value.version).map(([,value]) => value.id);
      if (!ids.length) return old;
      const docs = new Map(old.docs);
      for (const doc of await loadCompanyDocuments(db,'company_relationships',ids)) {
        if (doc.exists) docs.set(doc.id,doc as QueryDocumentSnapshot); else docs.delete(doc.id);
      }
      return build(docs,versions,index.generation);
    })();
    stores.set(db,next);
    try { return await next; }
    catch(error) { if(stores.get(db)===next) { if(previous)stores.set(db,previous);else stores.delete(db); } throw error; }
  });
}
export async function loadAllRelationships(db: Firestore) {
  const local=await localDocuments(db,'company_relationships');if(local)return {docs:local as QueryDocumentSnapshot[]};
  return {docs:[...(await loadStore(db)).docs.values()]};
}
async function select(db: Firestore, field: Field, value: string) {
  const local=await localDocuments(db,'company_relationships',undefined,field==='status'?{status:value}:{theme:value});if(local)return {docs:local as QueryDocumentSnapshot[]};
  const store = await loadStore(db);
  return {docs:[...(store.indexes[field].get(value) ?? [])].map(id => store.docs.get(id)!)};
}
export function loadPublishedRelationships(db: Firestore) { return select(db,'status','PUBLISHED'); }
export function loadThemeRelationships(db: Firestore, theme: string) { return select(db,'themeIds',theme); }
/** Union incoming/outgoing edges and exact IDs, including suppressed or malformed rows. */
export async function loadCompanyRelationships(db: Firestore, companyIds: readonly string[], exactIds: readonly string[] = []) {
  const local=await localDocuments(db,'company_relationships',undefined,{companyIds:[...companyIds],exactIds:[...exactIds]});if(local)return {docs:local as QueryDocumentSnapshot[]};
  const store = await loadStore(db), ids = new Set(exactIds);
  for (const companyId of companyIds) for (const field of ['source','target'] as const) {
    for (const id of store.indexes[field].get(companyId) ?? []) ids.add(id);
  }
  return {docs:[...ids].flatMap(id => { const doc=store.docs.get(id); return doc ? [doc] : []; })};
}

/** Match the existing Firestore document-ID range and limit before edge validation. */
export async function loadFilingRelationships(db: Firestore, prefix: string, limit = 100) {
  const local=await localDocuments(db,'company_relationships',undefined,{prefix,limit});if(local)return {docs:local as QueryDocumentSnapshot[]};
  const store = await loadStore(db), lower = Buffer.from(prefix), upper = Buffer.from(`${prefix}\uf8ff`);
  let start=0, end=store.sortedIds.length;
  while(start<end) { const mid=(start+end)>>>1; if(Buffer.compare(Buffer.from(store.sortedIds[mid]),lower)<0)start=mid+1;else end=mid; }
  const ids: string[]=[];
  for(let i=start;i<store.sortedIds.length && ids.length<limit;i++) {
    const id=store.sortedIds[i]; if(Buffer.compare(Buffer.from(id),upper)>=0)break; ids.push(id);
  }
  return {docs:ids.map(id=>store.docs.get(id)!)};
}
