import type {File} from '@google-cloud/storage';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {Readable,addAbortSignal} from 'node:stream';
import {SEC_BULK_MAX_JSON} from './sec-bulk-storage';

export type BulkZipEntry={fileName:string;uncompressedSize:number;compressedSize:number;crc32:number;generalPurposeBitFlag:number};
interface Zip extends EventEmitter {
  readEntry():void;close():void;
  openReadStream(entry:BulkZipEntry,callback:(error:Error|null,stream?:Readable)=>void):void;
}
interface ZipApi {
  RandomAccessReader:new()=>EventEmitter;
  fromRandomAccessReader(reader:EventEmitter,size:number,options:Record<string,unknown>,callback:(error:Error|null,zip?:Zip)=>void):void;
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}

/** Read small ZIP headers through a bounded page cache, large entries as streams. */
export function zipRangeSource(file:File,size:number,signal?:AbortSignal){
  const cancellable=(stream:Readable)=>signal?addAbortSignal(signal,stream):stream;
  const pages=new Map<number,Promise<Buffer>>(),pageSize=1024*1024;
  async function small(start:number,end:number){
    const chunks:Buffer[]=[];
    for(let cursor=start;cursor<end;){
      const base=Math.floor(cursor/pageSize)*pageSize;
      let pending=pages.get(base);
      if(!pending){
        pending=(async()=>{const chunks:Buffer[]=[];for await(const chunk of cancellable(file.createReadStream({start:base,end:Math.min(base+pageSize,size)-1,validation:false})))chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);})();
        pages.set(base,pending);if(pages.size>4)pages.delete(pages.keys().next().value!);
      }
      const bytes=await pending,next=Math.min(end,base+bytes.length);
      if(next<=cursor)throw Error('Truncated SEC bulk ZIP range');
      chunks.push(bytes.subarray(cursor-base,next-base));cursor=next;
    }
    return Buffer.concat(chunks);
  }
  return (start:number,end:number):Readable=>{
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>size)throw Error('Invalid SEC ZIP range');
    return cancellable(end-start<=65536?Readable.from((async function*(){yield await small(start,end);})()):file.createReadStream({start,end:end-1,validation:false}));
  };
}

/** No archive paths reach the filesystem; only canonical selected issuer JSON is read. */
export async function extractSelectedSecZip(options:{file:File;size:number;ciks:ReadonlySet<string>;signal:AbortSignal;
  save:(cik:string,bytes:Buffer)=>Promise<void>;minEntries?:number}){
  if(!Number.isSafeInteger(options.size)||options.size<22||options.size>8*1024**3)throw Error('Invalid SEC bulk ZIP size');
  if([...options.ciks].some(cik=>!/^\d{10}$/.test(cik)||Number(cik)===0))throw Error('Invalid SEC bulk issuer scope');
  options.signal.throwIfAborted();
  const api=createRequire(__filename)('yauzl') as ZipApi,range=zipRangeSource(options.file,options.size,options.signal);
  class Reader extends api.RandomAccessReader {_readStreamForRange(start:number,end:number){return range(start,end);}}
  const zip=await new Promise<Zip>((resolve,reject)=>api.fromRandomAccessReader(new Reader(),options.size,
    {lazyEntries:true,autoClose:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip!)));
  const selected=new Set<string>();let entries=0;
  try{
    await new Promise<void>((resolve,reject)=>{
      const fail=(error:unknown)=>{zip.close();reject(error);};
      zip.on('error',fail);zip.on('end',resolve);
      zip.on('entry',(entry:BulkZipEntry)=>{
        (async()=>{
          options.signal.throwIfAborted();if(++entries>500_000)throw Error('SEC ZIP entry limit exceeded');
          const match=/^CIK(\d{10})\.json$/.exec(entry.fileName);
          if(!match||!options.ciks.has(match[1]))return;
          if(selected.has(match[1]))throw Error('Duplicate SEC issuer ZIP entry');
          if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<=0||entry.uncompressedSize>SEC_BULK_MAX_JSON||entry.generalPurposeBitFlag&1)throw Error('Unsupported SEC bulk JSON entry');
          const stream=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream!)));
          const abort=()=>stream.destroy(options.signal.reason);options.signal.addEventListener('abort',abort,{once:true});
          const chunks:Buffer[]=[];let length=0;
          try{for await(const chunk of stream){options.signal.throwIfAborted();length+=chunk.length;if(length>SEC_BULK_MAX_JSON)throw Error('SEC bulk JSON byte limit exceeded');chunks.push(Buffer.from(chunk));}}
          finally{options.signal.removeEventListener('abort',abort);stream.destroy();}
          const bytes=Buffer.concat(chunks);
          if(bytes.length!==entry.uncompressedSize||crc32(bytes)!==entry.crc32)throw Error('SEC bulk ZIP content integrity mismatch');
          await options.save(match[1],bytes);selected.add(match[1]);
        })().then(()=>zip.readEntry()).catch(fail);
      });zip.readEntry();
    });
    if(entries<(options.minEntries??1000)||!selected.size)throw Error('SEC bulk ZIP coverage incomplete');
    return {entries,selected:[...selected].sort(),missing:[...options.ciks].filter(cik=>!selected.has(cik)).sort()};
  }finally{zip.close();}
}
