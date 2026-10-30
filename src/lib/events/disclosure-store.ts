import {headlineQueueFields} from '../intelligence/collectors/headline-queue';
import {calendarQueueFields} from '../calendar/queue';
import {markFeedChanged} from '../intelligence/feed-cache-changes';
import type {Firestore} from 'firebase-admin/firestore';
import type {Disclosure} from './disclosures';
import {EVENTS_COLLECTION} from './model';
import {classifyEvent} from './classification';
import {existingDocumentIds,runInsertTransaction} from '../firebase/insert-transaction';

export const DISCLOSURE_HISTORY_START='2026-01-01';
/** Immutable first collection time; re-scans do not manufacture new arrivals. */
export async function saveDisclosures(db:Firestore,rows:Disclosure[],at:string,baseline:boolean){
  const unique=[...new Map(rows.filter(r=>r.publication_date&&r.publication_date>=DISCLOSURE_HISTORY_START&&r.publication_date<=new Date(Date.parse(at)+(r.sourceType==='exchange'?8*3600000:0)).toISOString().slice(0,10)).map(r=>[r.id,r])).values()];
  let created=0;
  for(let start=0;start<unique.length;start+=100){
    const batch=unique.slice(start,start+100);
    created+=await runInsertTransaction(db,async tx=>{
      const refs=batch.map(row=>db.collection(EVENTS_COLLECTION).doc(row.id));
      const existing=await existingDocumentIds(tx,db.collection(EVENTS_COLLECTION),batch.map(row=>row.id));let count=0;
      batch.forEach((row,i)=>{if(!existing.has(row.id)){tx.create(refs[i],{...row,...headlineQueueFields(row),...calendarQueueFields(row),...classifyEvent(row),...(row.sourceType==='sec'&&/^(4|5)(\/A)?$/.test(String(row.form))?{insiderEnrichmentPending:true}:{}),collected_at:at,processed_at:at,baseline});markFeedChanged(db,tx,refs[i]);count++;}});return count;
    });
  }
  return created;
}
