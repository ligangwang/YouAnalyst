import type {Firestore} from 'firebase-admin/firestore';
import type {Snapshot} from '../entity-snapshots/sync';
import {instrumentFromCompany, instrumentId} from './model';
import {instrumentNeedsSync,syncCompanyInstrument} from './service';

/** Compare complete files in memory; no Firestore lookups for unchanged instruments. */
export async function syncSnapshotInstruments(db:Firestore,companies:Snapshot,existing?:Snapshot) {
  if(companies.collection!=='companies'||existing&&existing.collection!=='instruments')throw Error('Invalid instrument sync snapshots');
  const byId=new Map(existing?.rows.map(r=>[r.id,r.data])??[]);
  let updated=0,unchanged=0;
  for(const row of companies.rows){
    const next=instrumentFromCompany(row.id,row.data,String(row.data.supersededByCompanyId??row.id));
    if(!next)continue;
    if(!instrumentNeedsSync(byId.get(instrumentId(row.id)),next)){unchanged++;continue;}
    if((await syncCompanyInstrument(db,row.id,row.data)).changed)updated++;
  }
  return {updated,unchanged};
}
