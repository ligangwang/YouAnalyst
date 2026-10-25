import {BULK_RETENTION_DAYS,SEC_BULK_PREFIX} from './sec-bulk';

export type BulkObject={name:string;generation:string;timeCreated:string;temporaryHold?:boolean;eventBasedHold?:boolean};
/** Only raw provider bulk objects, never price history, snapshots or filing cache. */
export function isRetainedBulkObject(name:string){
  return /^eodhd-bulk-eod\/(US|SHG|SHE)\/\d{4}-\d{2}-\d{2}\.json$/.test(name)
    ||new RegExp(`^${SEC_BULK_PREFIX}snapshots/\\d{4}-\\d{2}-\\d{2}-[a-f0-9]{16}/((companyfacts|submissions)\\.zip|manifest\\.json|(companyfacts|submissions)/CIK\\d{10}\\.json)$`).test(name);
}

export function expiredBulkObjects(objects:BulkObject[],protectedNames:ReadonlySet<string>,now=Date.now()):BulkObject[]{
  return objects.filter(object=>isRetainedBulkObject(object.name)&&/^\d+$/.test(object.generation)
    &&!object.temporaryHold&&!object.eventBasedHold&&!protectedNames.has(object.name)
    &&Number.isFinite(Date.parse(object.timeCreated))&&now-Date.parse(object.timeCreated)>=BULK_RETENTION_DAYS*86400_000);
}

/** Adapters must condition deletion on this exact generation, preserving replacements. */
export async function cleanExpiredBulkObjects(options:{objects:BulkObject[];protectedNames:ReadonlySet<string>;now?:number;limit?:number;
  stillProtected:(object:BulkObject)=>Promise<boolean>;removeGeneration:(object:BulkObject)=>Promise<boolean|void>}){
  const candidates=expiredBulkObjects(options.objects,options.protectedNames,options.now),limit=options.limit??25;
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid bulk cleanup limit');
  let deleted=0,held=0;
  for(const object of candidates.slice(0,limit)){
    if(await options.stillProtected(object)){held++;continue;}
    if(await options.removeGeneration(object)===false){held++;continue;}deleted++;
  }
  return {deleted,held,remaining:Math.max(0,candidates.length-limit)};
}
