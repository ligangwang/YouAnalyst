import { FieldValue } from 'firebase-admin/firestore';
const tracked=new Set(['companies','company_fundamentals','company_relationships']);
/** Add a commit timestamp without replacing business/UI updatedAt fields. */
export function timestampWrite(method:string,path:string,args:unknown[],offset=0):unknown[]{
  if(path.split('/')[1]?.startsWith('_') || !tracked.has(path.split('/')[0]) || path.split('/').length!==2 || !['set','create','update'].includes(method))return args;
  const result=[...args],data=args[offset],timestamp=FieldValue.serverTimestamp();
  if(data && typeof data==='object' && !Array.isArray(data) && Object.getPrototypeOf(data)===Object.prototype){
    result[offset]={...data,cacheUpdatedAt:timestamp};
    const options=args[offset+1] as {mergeFields?:unknown[]}|undefined;
    if(method==='set' && options?.mergeFields)result[offset+1]={...options,mergeFields:[...options.mergeFields.filter(field=>String(field)!=='cacheUpdatedAt'),'cacheUpdatedAt']};
  }else if(method==='update'){
    const fields=result.splice(offset);const precondition=fields.length%2?fields.pop():undefined;
    result.push(...fields,'cacheUpdatedAt',timestamp,...(precondition?[precondition]:[]));
  }else throw Error('Unsupported tracked write');
  return result;
}
