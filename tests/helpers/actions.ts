import type {Firestore} from 'firebase-admin/firestore';
import {setActionRepositoryForTest} from '../../src/lib/action-store/runtime';
/** Existing business fixtures keep their data maps; only this test adapter uses
 * their Firestore-shaped methods. Production never takes this route. */
export function fixtureActions(value:object){
 const db=value as Firestore;
 setActionRepositoryForTest(value,{
  readTicker:async ticker=>(await db.collection('corporate_actions').where('ticker','==',ticker).get()).docs.map((doc,i)=>({id:doc.id??String(i),data:doc.data()})),
  mergeTicker:async(_ticker,rows)=>{const batch=db.batch();for(const row of rows)batch.set(db.collection('corporate_actions').doc(row.id),row.data,{merge:true});await batch.commit();},
 });
}
