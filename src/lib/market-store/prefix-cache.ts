import {deflateRawSync,inflateRawSync} from 'node:zlib';
type Lookup={compressed:Buffer;bloom:Uint8Array;ends:Uint32Array;ids:string[]};
function bits(value:string){let a=2166136261,b=0x9e3779b9;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return [a&262143,(a+b)&262143,(a+2*b)&262143];}
/** Immutable-file-keyed exact membership cache. Store UTF-8 bytes rather than
 * millions of JavaScript prefix strings; no expiry can hide a new generation. */
export class PrefixCache {
    private entries=new Map<string,{bytes:number;value:Promise<Lookup>}>();
    constructor(private budget=64*1024*1024){}
    clear(){this.entries.clear();}
    has(key:string){return this.entries.has(key);}
    async matching(key:string,value:string,load:()=>Promise<Array<{id:string;values:unknown}>>):Promise<string[]>{
        let entry=this.entries.get(key);
        if(!entry){
            const pending={bytes:0,value:(async()=>{
                const chunks:Buffer[]=[],ids:string[]=[],ends:number[]=[],bloom=new Uint8Array(32768);let total=0;
                for(const row of await load()){
                    const values=Array.isArray(row.values)?row.values.filter((v):v is string=>typeof v==='string'&&v.length>0&&!v.includes('\0')):[];
                    if(!values.length)continue;
                    for(const value of values)for(const bit of bits(value))bloom[bit>>>3]|=1<<(bit&7);
                    const bytes=Buffer.from('\0'+values.join('\0')+'\0');
                    chunks.push(bytes);total+=bytes.length;ids.push(row.id);ends.push(total);
                }
                return {compressed:deflateRawSync(Buffer.concat(chunks,total),{level:1}),bloom,ends:Uint32Array.from(ends),ids};
            })()};
            entry=pending;this.entries.set(key,pending);
            void pending.value.then(lookup=>{
                pending.bytes=lookup.compressed.length+lookup.bloom.byteLength+lookup.ends.byteLength+lookup.ids.reduce((n,id)=>n+64+Buffer.byteLength(id)*2,0);
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
        const tokens=inflateRawSync(lookup.compressed),needle=Buffer.from('\0'+value+'\0'),found=new Set<string>();
        for(let offset=tokens.indexOf(needle);offset>=0;offset=tokens.indexOf(needle,offset+1)){
            let low=0,high=lookup.ends.length;
            while(low<high){const middle=(low+high)>>>1;if(lookup.ends[middle]<=offset)low=middle+1;else high=middle;}
            if(low<lookup.ids.length)found.add(lookup.ids[low]);
        }
        return [...found];
    }
}
