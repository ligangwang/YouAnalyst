import { Timestamp, GeoPoint, type DocumentData } from 'firebase-admin/firestore';
// Tagged tuples avoid collisions with user document field names.
export function encode(value:unknown):unknown {
  if(value===undefined)return ['undefined'];
  if(value instanceof Timestamp)return ['timestamp',value.seconds,value.nanoseconds];
  if(value instanceof Date)return ['date',value.toISOString()];
  if(value instanceof GeoPoint)return ['geo',value.latitude,value.longitude];
  if(Buffer.isBuffer(value))return ['buffer',value.toString('base64')];
  if(Array.isArray(value))return ['array',value.map(encode)];
  if(value!==null && typeof value==='object'){
    if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('Unsupported cache value');
    return ['object',Object.entries(value).map(([k,v])=>[k,encode(v)])];
  }
  return ['scalar',value];
}
export function decode(wire:unknown):DocumentData {
  const [tag,...values]=wire as [string,...unknown[]];
  switch(tag){
    case 'undefined':return undefined as unknown as DocumentData;
    case 'timestamp':return new Timestamp(values[0] as number,values[1] as number);
    case 'date':return new Date(values[0] as string);
    case 'geo':return new GeoPoint(values[0] as number,values[1] as number);
    case 'buffer':return Buffer.from(values[0] as string,'base64');
    case 'array':return (values[0] as unknown[]).map(decode);
    case 'object':return Object.fromEntries((values[0] as [string,unknown][]).map(([k,v])=>[k,decode(v)]));
    case 'scalar':return values[0] as DocumentData;
    default:throw Error('Invalid cache response');
  }
}
