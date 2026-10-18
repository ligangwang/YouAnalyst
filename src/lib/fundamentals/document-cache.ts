import type { Firestore } from 'firebase-admin/firestore';
import { centralDocuments } from '../central-cache/client';
import { changeCached } from '../change-cache';

/** Central covered-company snapshot; retain the existing fallback for other companies. */
export async function loadFundamentalsSnapshot(db:Firestore,id:string){
 const central=await centralDocuments(db,'company_fundamentals',[id]);
 if(central!==undefined)return central[0];
 return changeCached(db,`fundamentals-document:${id}`,['company_fundamentals'],()=>db.collection('company_fundamentals').doc(id).get());
}
