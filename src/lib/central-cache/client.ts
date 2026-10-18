import type { ExchangeRegion } from '../market-companies/exchange-region';
import { GoogleAuth } from 'google-auth-library';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { decode } from './codec';
import type { Collection, Row, RelationshipQuery } from './store';
const auth=new GoogleAuth();
export async function centralRequest(path:string, body:unknown):Promise<unknown|undefined>{
  const url=process.env.CENTRAL_CACHE_URL;if(!url)return undefined;
  try {
    const target=new URL(url);if(target.protocol!=='https:' && !['127.0.0.1','localhost'].includes(target.hostname))throw Error('Invalid central cache URL');
    const client=target.protocol==='https:'?await auth.getIdTokenClient(url):null;
    const headers=client?await client.getRequestHeaders():new Headers();headers.set('content-type','application/json');
    const response=await fetch(`${url}${path}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error(`Central cache ${response.status}`);return await response.json();
  }catch(error){console.warn('central_cache_fallback',error instanceof Error?error.message:'unavailable');return undefined;}
}
export async function centralDocuments(db:Firestore,collection:Collection,ids?:string[],query?:RelationshipQuery,projection?:'marketCap',exchangeRegion?:ExchangeRegion):Promise<DocumentSnapshot[]|undefined>{
  const wire=await centralRequest('/read',{collection,ids,query,projection,exchangeRegion});if(wire===undefined)return;
  const rows=decode(wire) as Row[];const byId=new Map(rows.map(row=>[row.id,row]));
  return (ids??rows.map(row=>row.id)).map(id=>({id,exists:byId.has(id),ref:db.collection(collection).doc(id),data:()=>byId.get(id)?.data,get:(field:string)=>field.split('.').reduce<unknown>((value,key)=>(value as Record<string,unknown>|undefined)?.[key],byId.get(id)?.data)}) as DocumentSnapshot);
}
