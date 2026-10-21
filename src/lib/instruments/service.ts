import {FieldValue, type Firestore, type DocumentData, type DocumentSnapshot, type QuerySnapshot} from 'firebase-admin/firestore';
import {collectionSourceSnapshot, withSourceCache} from '../local-cache/read-scope';
import {entityPatch} from '../entity-snapshots/lifecycle';
import {instrumentFromCompany, instrumentId, validInstrumentId, validateInstrument, type Instrument} from './model';

async function companyDoc(db: Firestore, id: string): Promise<DocumentSnapshot> {
  if (!id || id.includes('/')) throw Error('Invalid company ID');
  const ref = db.collection('companies').doc(id);
  return withSourceCache(() => collectionSourceSnapshot(db,ref,'companies') ?? ref.get());
}
/** Alias records remain readable for old URLs and historical references. */
export async function resolveIssuer(db: Firestore, id: string): Promise<{id: string; data: DocumentData} | null> {
  const seen = new Set<string>();
  for (let depth=0;depth<8;depth++) {
    if (seen.has(id)) throw Error('Company alias cycle');
    seen.add(id);
    const doc = await companyDoc(db,id), data = doc.data();
    if (!data || data.isDeleted === true) return null;
    if (!data.supersededByCompanyId) return {id:doc.id,data};
    if (typeof data.supersededByCompanyId !== 'string') throw Error('Invalid company alias');
    id=data.supersededByCompanyId;
  }
  throw Error('Company alias depth exceeded');
}
export async function loadInstrument(db: Firestore, id: string): Promise<({id: string} & Instrument) | null> {
  if (!validInstrumentId(id)) throw Error('Invalid instrument ID');
  const ref=db.collection('instruments').doc(id);
  const doc:DocumentSnapshot=await withSourceCache(()=>collectionSourceSnapshot(db,ref,'instruments')??ref.get());
  const data=doc.data();
  return data && data.isDeleted!==true ? {id:doc.id,...validateInstrument(data as Instrument)} : null;
}
export async function companyInstruments(db:Firestore,companyId:string) {
  const company=await resolveIssuer(db,companyId);
  if(!company)return [];
  const query=db.collection('instruments').where('companyId','==',company.id);
  const snapshot:QuerySnapshot=await withSourceCache(()=>collectionSourceSnapshot(db,query,'instruments')??query.get());
  return snapshot.docs.filter(d=>d.get('isDeleted')!==true).map(d=>({id:d.id,...validateInstrument(d.data() as Instrument)}));
}
/** Prices and watchlists retain their old keys until each historical store is migrated. */
export async function resolveInstrumentContext(db:Firestore,idOrLegacyId:string) {
  const id=validInstrumentId(idOrLegacyId)?idOrLegacyId:instrumentId(idOrLegacyId);
  const instrument=await loadInstrument(db,id);
  if(!instrument)return null;
  const company=await resolveIssuer(db,instrument.companyId);
  if(!company)return null;
  const legacyKey=instrument.providerSymbols.youanalyst;
  return {instrument,company,historyKey:legacyKey&&/^(US:|XSHG:|XSHE:|XBSE:)/.test(legacyKey)?legacyKey:null};
}
const same = (a:unknown,b:unknown):boolean=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  const x=a as DocumentData,y=b as DocumentData;
  return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>same(x[k],y[k]));
};
export function instrumentNeedsSync(previous:DocumentData|undefined,next:Instrument) {
  return !previous || !Object.entries(next).every(([k,v])=>k==='sourceMetadata'
    ? same({...previous.sourceMetadata,observedAt:undefined},{...next.sourceMetadata,observedAt:undefined}) : same(previous[k],v));
}

/** Called by importers with their already-loaded company row; never on a page read. */
export async function syncCompanyInstrument(db:Firestore,legacyId:string,company:DocumentData) {
  const next=instrumentFromCompany(legacyId,company,String(company.supersededByCompanyId??legacyId));
  if(!next)return {changed:false};
  if(next.sourceMetadata.observedAt==='1970-01-01T00:00:00.000Z')next.sourceMetadata.observedAt=new Date().toISOString();
  validateInstrument(next);
  const ref=db.collection('instruments').doc(instrumentId(legacyId));
  return db.runTransaction(async tx=>{
    const refs=[ref,db.collection('companies').doc(next.companyId)];
    if(legacyId!==next.companyId)refs.push(db.collection('companies').doc(legacyId));
    const [doc,owner,legacy]=await tx.getAll(...refs);
    if(!owner.exists||owner.get('isDeleted')===true||owner.get('supersededByCompanyId'))throw Error('Instrument company unavailable');
    const source=legacy??owner;
    if(!source.exists||source.get('isDeleted')===true)return {changed:false};
    if(String(source.get('supersededByCompanyId')??legacyId)!==next.companyId)throw Error('Company link changed during instrument sync');
    const current=instrumentFromCompany(legacyId,source.data()!,next.companyId);
    if(!current)return {changed:false};
    if(current.sourceMetadata.observedAt==='1970-01-01T00:00:00.000Z')current.sourceMetadata.observedAt=new Date().toISOString();
    const previous=doc.data();
    if(previous?.isDeleted===true)return {changed:false};
    if(previous && previous.companyId!==next.companyId)throw Error('Instrument issuer changed; review required');
    if(!instrumentNeedsSync(previous,current))return {changed:false};
    const patch:DocumentData={...current};
    if(previous?.symbol && previous.symbol!==current.symbol)patch.symbolHistory=[...(previous.symbolHistory??[]),{symbol:previous.symbol}];
    if(!previous)patch.createdAt=FieldValue.serverTimestamp();
    tx.set(ref,entityPatch(previous,patch)!,{merge:true});
    return {changed:true};
  });
}
