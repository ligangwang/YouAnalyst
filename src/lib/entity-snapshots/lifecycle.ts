import {FieldValue, Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction} from 'firebase-admin/firestore';
import {collections} from './sync';

export function isEntityPath(path:string) {
  const parts=path.split('/');
  return parts.length===2&&!parts[1].startsWith('_')&&(collections as readonly string[]).includes(parts[0]);
}

/** Preserve lifecycle fields even when an existing writer replaces a document.
 * Values supplied for deletedAt never override the original deletion time. */
export function lifecycleFields(previous:DocumentData|undefined, requested:unknown, replacing=false):DocumentData {
  if(requested!==undefined&&typeof requested!=='boolean')throw Error('isDeleted must be a boolean');
  if(requested===false)return {isDeleted:false,...(replacing?{}:{deletedAt:FieldValue.delete()})};
  if(previous?.isDeleted===true){
    const deletedAt=previous.deletedAt??previous.updatedAt;
    if(!(deletedAt instanceof Timestamp))throw Error('Timestamp migration required before editing a deleted entity');
    return {isDeleted:true,deletedAt};
  }
  if(requested===true)return {isDeleted:true,...(replacing?{}:{deletedAt:FieldValue.delete()})};
  return {};
}

/** Called with the transaction's current document, never a cached read. */
export function entityPatch(previous:DocumentData|undefined, patch:DocumentData, action:'edit'|'delete'|'restore'='edit'):DocumentData|null {
  if(Object.hasOwn(patch,'isDeleted')||Object.hasOwn(patch,'deletedAt'))throw Error('Use delete/restore actions for lifecycle fields');
  if(action==='delete') {
    if(!previous||previous.isDeleted===true)return null;
    return {isDeleted:true,deletedAt:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};
  }
  if(action==='restore') {
    if(!previous)throw Error('Cannot restore a missing entity');
    return {...patch,isDeleted:false,deletedAt:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};
  }
  const result={...patch,updatedAt:FieldValue.serverTimestamp()};
  if(previous?.isDeleted===true){
    const deletedAt=previous.deletedAt??previous.updatedAt;
    if(!(deletedAt instanceof Timestamp))throw Error('Timestamp migration required before editing a deleted entity');
    return {...result,isDeleted:true,deletedAt};
  }
  return result;
}

export function applyEntityPatch(tx:Transaction,ref:DocumentReference,previous:DocumentData|undefined,patch:DocumentData={},action:'edit'|'delete'|'restore'='edit') {
  if(!isEntityPath(ref.path))throw Error('Unsupported entity path');
  const data=entityPatch(previous,patch,action);
  if(data)tx.set(ref,data,{merge:true});
}

export async function mutateEntity(db:Firestore,path:string,patch:DocumentData={},action:'edit'|'delete'|'restore'='edit') {
  if(!isEntityPath(path))throw Error('Unsupported entity path');
  const ref=db.doc(path);
  await db.runTransaction(async tx=>{
    const current=await tx.get(ref);
    applyEntityPatch(tx,ref,current.data(),patch,action);
  });
}
