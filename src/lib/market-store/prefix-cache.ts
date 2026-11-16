import {deflateRawSync,inflateRawSync} from 'node:zlib';
export type PrefixRows=Array<{id:string;values:unknown}>;
export type PrefixLookup={compressed:Buffer;bloom:Uint8Array;ends:Uint32Array;ids:string[];packedIds?:{bytes:Buffer;ends:Uint32Array};rawBytes:number};
const lookupId=(value:PrefixLookup,index:number):string=>value.packedIds?value.packedIds.bytes.toString('utf8',index?value.packedIds.ends[index-1]:0,value.packedIds.ends[index]):value.ids[index];
const lookupIds=(value:PrefixLookup):string[]=>value.packedIds?Array.from(value.packedIds.ends,(_,i)=>lookupId(value,i)):value.ids;
function bits(value:string){let a=2166136261,b=0x9e3779b9;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return [a&262143,(a+b)&262143,(a+2*b)&262143];}
export function buildPrefixLookup(rows:PrefixRows):PrefixLookup{
    const chunks:Buffer[]=[],ids:string[]=[],ends:number[]=[],bloom=new Uint8Array(32768);let total=0;
    for(const row of rows){
        const values=Array.isArray(row.values)?row.values.filter((v):v is string=>typeof v==='string'&&v.length>0&&!v.includes('\0')):[];
        if(!values.length)continue;
        for(const value of values)for(const bit of bits(value))bloom[bit>>>3]|=1<<(bit&7);
        const bytes=Buffer.from('\0'+values.join('\0')+'\0');chunks.push(bytes);total+=bytes.length;ids.push(row.id);ends.push(total);
    }
    return {compressed:deflateRawSync(Buffer.concat(chunks,total),{level:1}),bloom,ends:Uint32Array.from(ends),ids,rawBytes:total};
}
export function encodePrefixLookup(value:PrefixLookup){
    const ends=Buffer.alloc(value.ends.byteLength);value.ends.forEach((end,i)=>ends.writeUInt32LE(end,i*4));
    return JSON.stringify({version:1,compressed:value.compressed.toString('base64'),bloom:Buffer.from(value.bloom).toString('base64'),ends:ends.toString('base64'),ids:lookupIds(value),rawBytes:value.rawBytes});
}
export function decodePrefixLookup(payload:string,packIds=false):PrefixLookup{
    const wire=JSON.parse(payload),bloom=Buffer.from(wire.bloom,'base64'),bytes=Buffer.from(wire.ends,'base64');
    if(wire.version!==1||bloom.length!==32768||!Array.isArray(wire.ids)||wire.ids.some((id:unknown)=>typeof id!=='string')||bytes.length!==wire.ids.length*4||!Number.isSafeInteger(wire.rawBytes)||wire.rawBytes<0||wire.rawBytes>256*1024*1024)throw Error('Invalid prefix index');
    const ends=Uint32Array.from(wire.ids.map((_:string,i:number)=>bytes.readUInt32LE(i*4)));
    if((ends.at(-1)??0)!==wire.rawBytes||ends.some((end,i)=>end<1||(i>0&&end<=ends[i-1])))throw Error('Invalid prefix offsets');
    // Keep IDs as UTF-8 bytes and decode only matches. Re-inflating a JSON array
    // of every event ID for each company lookup wasted CPU and temporary heap.
    let packed:PrefixLookup['packedIds'];
    if(packIds){const chunks=(wire.ids as string[]).map(id=>Buffer.from(id));let length=0;const ends=Uint32Array.from(chunks,bytes=>length+=bytes.length);packed={bytes:Buffer.concat(chunks,length),ends};}
    return {compressed:Buffer.from(wire.compressed,'base64'),bloom,ends,ids:packIds?[]:wire.ids,...(packed?{packedIds:packed}:{}),rawBytes:wire.rawBytes};
}
/** Immutable-file-keyed exact membership cache. Store UTF-8 bytes rather than
 * millions of JavaScript prefix strings; no expiry can hide a new generation. */
export class PrefixCache {
    private entries=new Map<string,{bytes:number;value:Promise<PrefixLookup>}>();
    constructor(private budget=64*1024*1024){}
    clear(){this.entries.clear();}
    has(key:string){return this.entries.has(key);}
    async matching(key:string,value:string,load:()=>Promise<PrefixRows|PrefixLookup>):Promise<string[]>{
        let entry=this.entries.get(key);
        if(!entry){
            const pending={bytes:0,value:(async()=>{
                const loaded=await load();return Array.isArray(loaded)?buildPrefixLookup(loaded):loaded;
            })()};
            entry=pending;this.entries.set(key,pending);
            void pending.value.then(lookup=>{
                pending.bytes=lookup.compressed.length+lookup.bloom.byteLength+lookup.ends.byteLength+(lookup.packedIds?lookup.packedIds.bytes.length+lookup.packedIds.ends.byteLength:lookup.ids.reduce((n,id)=>n+64+Buffer.byteLength(id)*2,0));
                let total=[...this.entries.values()].reduce((n,item)=>n+item.bytes,0);
                for(const [name,item] of this.entries){
                    if(total<=this.budget&&this.entries.size<=512)break;
                    this.entries.delete(name);total-=item.bytes;
                }
            }).catch(()=>{if(this.entries.get(key)===pending)this.entries.delete(key);});
        }else{this.entries.delete(key);this.entries.set(key,entry);}
        const lookup=await entry.value;
        // Bloom misses avoid decompression; hits still require exact bytes.
        if(bits(value).some(bit=>!(lookup.bloom[bit>>>3]&(1<<(bit&7)))))return [];
        const tokens=inflateRawSync(lookup.compressed,{maxOutputLength:lookup.rawBytes}),needle=Buffer.from('\0'+value+'\0'),found=new Set<string>();
        if(tokens.length!==lookup.rawBytes)throw Error('Invalid prefix data size');
        for(let offset=tokens.indexOf(needle);offset>=0;offset=tokens.indexOf(needle,offset+1)){
            let low=0,high=lookup.ends.length;
            while(low<high){const middle=(low+high)>>>1;if(lookup.ends[middle]<=offset)low=middle+1;else high=middle;}
            if(low<lookup.ends.length)found.add(lookupId(lookup,low));
        }
        return [...found];
    }
}
