import type { Firestore } from 'firebase-admin/firestore';
import { localDocuments } from '../local-cache/entities';
import { changeCached } from '../change-cache';

/** Push-synchronized local snapshot, including companies outside graph coverage. */
export async function loadFundamentalsSnapshot(db:Firestore,id:string){
 const local=await localDocuments(db,'company_fundamentals',[id]);
 if(local!==undefined)return local[0];
 return changeCached(db,`fundamentals-document:${id}`,['company_fundamentals'],()=>db.collection('company_fundamentals').doc(id).get());
}
