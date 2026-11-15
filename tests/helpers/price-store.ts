import {readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import type {Bucket} from '@google-cloud/storage';
import {PriceStore} from '../../src/lib/price-store/storage';
export function createPriceFixture(){
 const failDelete=new Set<string>();
 let sequence=0;const objects=new Map<string,{generation:string;bytes:Buffer}>();
 const failure=(code:number)=>Object.assign(Error(String(code)),{code});
 const bucket={file:(name:string,pinned?:{generation:string})=>({
  createReadStream:()=>{const entry=objects.get(name);if(!entry||pinned&&pinned.generation!==entry.generation)throw failure(404);return Readable.from([entry.bytes]);},
  delete:async()=>{if(failDelete.delete(name))throw Error('Simulated cleanup crash');objects.delete(name);},
  getMetadata:async()=>{const entry=objects.get(name);if(!entry)throw failure(404);return [{generation:entry.generation}];},
  download:async(options?:{destination:string})=>{const entry=objects.get(name);if(!entry||pinned&&pinned.generation!==entry.generation)throw failure(404);if(options)await writeFile(options.destination,entry.bytes);return [entry.bytes];},
  save:async(bytes:string,options:{preconditionOpts:{ifGenerationMatch:string}})=>{if((objects.get(name)?.generation??'0')!==String(options.preconditionOpts.ifGenerationMatch))throw failure(412);objects.set(name,{generation:String(++sequence),bytes:Buffer.from(bytes)});},
 }),upload:async(path:string,options:{destination:string})=>{objects.set(options.destination,{generation:String(++sequence),bytes:await readFile(path)});}} as unknown as Bucket;
 return {objects,bucket,store:new PriceStore(bucket),failDelete};
}
