import {collections} from '../entity-snapshots/sync';
import { FieldValue } from 'firebase-admin/firestore';
const tracked=new Set<string>(collections);
/** The persisted document's last change is always a server commit timestamp. */
export function timestampWrite(method:string,path:string,args:unknown[],offset=0):unknown[]{
  if(path.split('/')[1]?.startsWith('_') || !tracked.has(path.split('/')[0]) || path.split('/').length!==2 || !['set','create','update'].includes(method))return args;
  const result=[...args],data=args[offset],timestamp=FieldValue.serverTimestamp();
  if(data && typeof data==='object' && !Array.isArray(data) && Object.getPrototypeOf(data)===Object.prototype){
    const payload={...data} as Record<string,unknown>;
    delete payload.cacheUpdatedAt;
    result[offset]={...payload,updatedAt:timestamp};
    const options=args[offset+1] as {mergeFields?:unknown[]}|undefined;
    if(method==='set' && options?.mergeFields)result[offset+1]={...options,mergeFields:[...options.mergeFields.filter(field=>!['cacheUpdatedAt','updatedAt'].includes(String(field))),'updatedAt']};
  }else if(method==='update'){
    const fields=result.splice(offset);const precondition=fields.length%2?fields.pop():undefined;
    for(let i=0;i<fields.length;i+=2){
      if(!['cacheUpdatedAt','updatedAt'].includes(String(fields[i])))result.push(fields[i],fields[i+1]);
    }
    result.push('updatedAt',timestamp,...(precondition?[precondition]:[]));
  }else throw Error('Unsupported tracked write');
  return result;
}
