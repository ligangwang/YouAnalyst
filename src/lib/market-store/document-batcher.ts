/** Coalesce simultaneous small ID reads before they enter the shared DuckDB
 * queue. Each caller keeps its own projection, ordering and missing-ID result.
 * This is not a cache; the repository still owns invalidation and retention. */
export class DocumentBatcher<T extends {id:string}> {
    private pending=new Map<string,{ids:Set<string>;waiters:Array<{ids:string[];resolve:(rows:T[])=>void;reject:(error:unknown)=>void}>}>();
    constructor(private limit=512){}
    load(key:string,ids:string[],read:(ids:string[])=>Promise<T[]>):Promise<T[]> {
        if(ids.length>=this.limit)return read(ids);
        let group=this.pending.get(key);
        if(group&&new Set([...group.ids,...ids]).size>this.limit)group=undefined;
        if(!group){
            group={ids:new Set(),waiters:[]};this.pending.set(key,group);
            const selected=group;
            setImmediate(()=>{
                if(this.pending.get(key)===selected)this.pending.delete(key);
                void Promise.resolve().then(()=>read([...selected.ids])).then(rows=>{
                    const found=new Map(rows.map(row=>[row.id,row]));
                    for(const waiter of selected.waiters)waiter.resolve(waiter.ids.flatMap(id=>found.has(id)?[found.get(id)!]:[]));
                },error=>{for(const waiter of selected.waiters)waiter.reject(error);});
            });
        }
        for(const id of ids)group.ids.add(id);
        const selected=group;
        return new Promise((resolve,reject)=>selected.waiters.push({ids:[...ids],resolve,reject}));
    }
}
