import {Writable,Readable} from 'node:stream';
import type {Bucket,FileMetadata} from '@google-cloud/storage';

export function bulkStorage(){
  const rows=new Map<string,{bytes:Buffer;metadata:FileMetadata}>();let generation=0;
  const ref=(name:string,options?:{generation?:string|number})=>({name,
    get metadata(){return rows.get(name)?.metadata??{};},
    getMetadata:async()=>{const row=rows.get(name);if(!row)throw {code:404};return [row.metadata];},
    download:async()=>{const row=rows.get(name);if(!row||options?.generation&&String(options.generation)!==row.metadata.generation)throw {code:404};return [row.bytes];},
    createReadStream:({start=0,end}:{start?:number;end?:number})=>{const row=rows.get(name);if(!row)throw {code:404};return Readable.from([row.bytes.subarray(start,end===undefined?undefined:end+1)]);},
    save:async(bytes:string|Buffer,settings:{preconditionOpts?:{ifGenerationMatch?:string|number};metadata?:FileMetadata}={})=>{
      const old=rows.get(name),expected=settings.preconditionOpts?.ifGenerationMatch;
      if(expected!==undefined&&String(expected)!==(old?.metadata.generation??'0'))throw {code:412};
      rows.set(name,{bytes:Buffer.from(bytes),metadata:{...settings.metadata,generation:String(++generation),metageneration:'1',size:String(Buffer.byteLength(bytes)),timeCreated:new Date().toISOString()}});
    },
    setMetadata:async(next:FileMetadata)=>{const row=rows.get(name);if(!row)throw {code:404};Object.assign(row.metadata,next,{metageneration:String(Number(row.metadata.metageneration)+1)});return [row.metadata];},
    delete:async(condition:{ifGenerationMatch:string; ifMetagenerationMatch:number})=>{
      const row=rows.get(name);if(!row)throw {code:404};if(row.metadata.temporaryHold)throw {code:403};
      if(row.metadata.generation!==condition.ifGenerationMatch||Number(row.metadata.metageneration)!==condition.ifMetagenerationMatch)throw {code:412};rows.delete(name);
    },
    createWriteStream:(settings:{preconditionOpts?:{ifGenerationMatch?:string|number};metadata?:FileMetadata})=>{
      const chunks:Buffer[]=[];
      return new Writable({write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback();},final(callback){ref(name).save(Buffer.concat(chunks),settings).then(()=>callback(),callback);}});
    },
  });
  const value={file:ref,getFiles:async({prefix,maxResults,pageToken}:{prefix:string;maxResults:number;pageToken?:string})=>{
    const names=[...rows.keys()].filter(name=>name.startsWith(prefix)).sort(),start=Number(pageToken??0),selected=names.slice(start,start+maxResults);
    return [selected.map(name=>ref(name)),start+maxResults<names.length?{pageToken:String(start+maxResults)}:null];
  }} as unknown as Bucket;
  return {value,rows};
}
