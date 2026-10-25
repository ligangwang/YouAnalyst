import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION,validRequesterUid} from './model';

export const REQUESTERS_COLLECTION='requesters';
export type InstrumentRequester={requestedByUid:string;requestedAt:string};
export type InstrumentRequestersPage={items:InstrumentRequester[];nextCursor:string|null};
export const requesterId=(uid:string)=>createHash('sha256').update(`instrument-onboarding-requester-v1:${uid}`).digest('hex');
export const validRequesterCursor=(value:string)=>/^[a-f0-9]{64}$/.test(value);

/** Private admin read, paginated independently from the shared job. */
export async function listInstrumentRequesters(db:Firestore,instrumentId:string,cursor?:string):Promise<InstrumentRequestersPage>{
  if(!validInstrumentId(instrumentId)||(cursor&&!validRequesterCursor(cursor)))throw Error('Invalid requester query');
  let query=db.collection(ONBOARDING_COLLECTION).doc(instrumentId).collection(REQUESTERS_COLLECTION).orderBy('__name__').limit(26);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get(),selected=page.docs.slice(0,25);
  return {items:selected.map(doc=>{
    const value=doc.data() as InstrumentRequester;
    if(!validRequesterUid(value.requestedByUid)||requesterId(value.requestedByUid)!==doc.id||!Number.isFinite(Date.parse(value.requestedAt)))throw Error('Invalid requester record');
    return {requestedByUid:value.requestedByUid,requestedAt:value.requestedAt};
  }),nextCursor:page.docs.length>25?selected.at(-1)!.id:null};
}
