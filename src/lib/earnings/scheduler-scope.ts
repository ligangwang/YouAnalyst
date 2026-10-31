import {FieldPath,type Firestore,type QueryDocumentSnapshot} from 'firebase-admin/firestore';
import {getAdminStorageBucket} from '../firebase/admin';
import {loadEntitySqlite,type EntityRows} from '../entity-snapshots/sqlite';
import {COMPANY_VIEW_OBJECT} from '../entity-snapshots/company-view';
import {COLLECTION_COMPANY_FIELDS,readCollectionCompanies} from '../company-support/collection-reader';
import {isSupportedCompany} from '../company-support/model';
import type {ThemedCompany} from '../company-themes/model';

async function snapshot(){
  const bucket=process.env.ENTITY_SNAPSHOT_BUCKET?.trim()||process.env.EODHD_BULK_EOD_BUCKET?.trim();
  return bucket?loadEntitySqlite(getAdminStorageBucket(bucket),'cold',undefined,'companies',COMPANY_VIEW_OBJECT):undefined;
}

/** One-shot CN candidate scope. Workers still recheck authoritative enrollment.
 * Do not attach the global directory listener: unrelated US updates during the
 * paced dispatch would cost reads without changing this run's candidate list. */
export async function readEarningsScheduleCompanies(db:Firestore,loadSnapshot:()=>Promise<EntityRows|undefined>=snapshot){
  const rows=await loadSnapshot();
  // Missing snapshots use the existing bounded CN scan, never a global scan.
  if(!rows)return readCollectionCompanies(db,[],'CN');
  if(!rows.watermark)throw Error('Earnings company snapshot has no freshness boundary');
  const cn=(id:string)=>/^(XSHE|XSHG):/.test(id);
  const candidates=new Map<string,ThemedCompany>();
  for(const [id,data] of rows)if(cn(id))candidates.set(id,{...data,id} as ThemedCompany);
  const base=db.collection('companies').where('updatedAt','>=',rows.watermark)
    .where(FieldPath.documentId(),'>=','XSHE:').where(FieldPath.documentId(),'<','XSHG;')
    .orderBy('updatedAt').orderBy(FieldPath.documentId()).select(...COLLECTION_COMPANY_FIELDS,'updatedAt');
  let cursor:QueryDocumentSnapshot|undefined;
  for(;;){
    const page=await(cursor?base.startAfter(cursor):base).limit(250).get();
    for(const doc of page.docs)candidates.set(doc.id,{...doc.data(),id:doc.id} as ThemedCompany);
    if(page.size<250)break;
    cursor=page.docs.at(-1);
  }
  return [...candidates.values()].filter(isSupportedCompany).sort((a,b)=>a.id.localeCompare(b.id));
}
