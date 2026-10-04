import type {Firestore} from 'firebase-admin/firestore';
import type {Disclosure} from './disclosures';
import {EVENTS_COLLECTION} from './model';

export const DISCLOSURE_HISTORY_START='2026-01-01';
/** Immutable first collection time; re-scans do not manufacture new arrivals. */
export async function saveDisclosures(db:Firestore,rows:Disclosure[],at:string,baseline:boolean){
  const unique=[...new Map(rows.filter(r=>r.publication_date&&r.publication_date>=DISCLOSURE_HISTORY_START&&r.publication_date<=new Date(Date.parse(at)+(r.sourceType==='exchange'?8*3600000:0)).toISOString().slice(0,10)).map(r=>[r.id,r])).values()];
  let created=0;
  for(let start=0;start<unique.length;start+=100){
    const batch=unique.slice(start,start+100);
    created+=await db.runTransaction(async tx=>{
      const refs=batch.map(row=>db.collection(EVENTS_COLLECTION).doc(row.id)),docs=await tx.getAll(...refs);let count=0;
      batch.forEach((row,i)=>{if(!docs[i].exists){tx.create(refs[i],{...row,collected_at:at,processed_at:at,baseline});count++;}});return count;
    });
  }
  return created;
}
