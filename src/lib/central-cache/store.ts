import type { ExchangeRegion } from '../market-companies/exchange-region';
/** Pure cache engine. Checkpoints and documents are published atomically. */
export const collections = ['companies','company_fundamentals','company_relationships'] as const;
export type Collection = typeof collections[number];
export type Row = {id:string; data:Record<string,unknown>; deleted?:boolean};
export type Stamp = {seconds:number; nanoseconds:number};
export interface Source {
  boundary(): Promise<Stamp>;
  initial(collection:Collection, companyIds:string[]):Promise<Row[]>;
  changes(collection:Collection, since:Stamp, through:Stamp, companyIds:string[]):Promise<Row[]>;
  documents(collection:Collection, ids:string[]):Promise<Row[]>;
}
export type RelationshipQuery = {status?:string;theme?:string;companyIds?:string[];exactIds?:string[];prefix?:string;limit?:number};
type State = {rows:Map<string,Row>; checkpoint:Stamp};
const enrolled = (row:Row) => Array.isArray(row.data.themeIds) && row.data.themeIds.some(t=>typeof t==='string' && /^[a-z][a-z0-9-]{0,79}$/.test(t));
export class CentralCache {
  private states = new Map<Collection,State>();
  private queue:Promise<unknown> = Promise.resolve();
  private companyRegionIndex?: {state:State; regions:Map<ExchangeRegion,Row[]>};
  private relationshipIndex?: {state:State; fields:Map<string,Map<string,Set<string>>>; sorted:string[]};
  private versions = new Map<Collection,string>();
  constructor(private source:Source) {}
  private serial<T>(work:()=>Promise<T>):Promise<T> { const next=this.queue.catch(()=>undefined).then(work);this.queue=next;return next; }
  private ids() { return [...(this.states.get('companies')?.rows.keys() ?? [])]; }
  async warm() { return this.serial(async()=>{if(this.states.size===3)return; const checkpoint=await this.source.boundary(); const staged=new Map<Collection,State>();
    const companies=await this.source.initial('companies',[]);const ids=companies.map(row=>row.id);
    for(const collection of collections) {const rows=collection==='companies'?companies:await this.source.initial(collection,ids);staged.set(collection,{rows:new Map(rows.map(row=>[row.id,row])),checkpoint});}
    this.states=staged;
  }); }
  /** Events carry IDs for hard deletes and compatibility with old writers. They do
   * not require persistent per-ID invalidation metadata. Duplicate events are safe. */
  async refresh(collection:Collection, version:string, eventIds:string[]=[]){await this.warm();return this.serial(async()=>{
    if(this.versions.get(collection)===version && !eventIds.length)return;
    const old=this.states.get(collection)!,through=await this.source.boundary();
    const changed=await this.source.changes(collection,old.checkpoint,through,this.ids());
    const current=eventIds.length?await this.source.documents(collection,eventIds):[];
    const rows=new Map(old.rows);
    for(const row of changed) {
      if(row.deleted){rows.delete(row.id);continue;}
      if(collection==='companies' && !enrolled(row))rows.delete(row.id);
      else if(collection!=='company_fundamentals' || this.states.get('companies')!.rows.has(row.id))rows.set(row.id,row);
    }
    for(const id of eventIds)rows.delete(id);
    for(const row of current)if(collection!=='companies' || enrolled(row)){if(collection!=='company_fundamentals' || this.states.get('companies')!.rows.has(row.id))rows.set(row.id,row);}
    // Enrollment changes fetch fundamentals for newly covered companies only.
    let fundamentals:State|undefined;
    if(collection==='companies'){
      const prior=this.states.get('company_fundamentals')!;const next=new Map(prior.rows);
      const added=[...rows.keys()].filter(id=>!old.rows.has(id));
      for(const id of next.keys())if(!rows.has(id))next.delete(id);
      for(const row of await this.source.documents('company_fundamentals',added))next.set(row.id,row);
      fundamentals={...prior,rows:next};
    }
    this.states.set(collection,{rows,checkpoint:through});if(fundamentals)this.states.set('company_fundamentals',fundamentals);
    this.versions.set(collection,version);
  });}
  read(collection:Collection, ids?:string[]) {const state=this.states.get(collection);if(!state)throw Error('Cache not ready');return ids?ids.flatMap(id=>{const row=state.rows.get(id);return row?[row]:[];}):[...state.rows.values()];}
  companies(region:ExchangeRegion):Row[] {
    const state=this.states.get('companies');if(!state)throw Error('Cache not ready');
    if(this.companyRegionIndex?.state!==state){
      const regions=new Map<ExchangeRegion,Row[]>([['US',[]],['CN',[]]]);
      for(const row of state.rows.values()){
        const value=row.data.exchange_region;
        if(value==='US'||value==='CN')regions.get(value)!.push(row);
      }
      this.companyRegionIndex={state,regions};
    }
    return [...this.companyRegionIndex.regions.get(region)!];
  }
  relationships(query:RelationshipQuery):Row[] {
    const state=this.states.get('company_relationships');if(!state)throw Error('Cache not ready');
    if(this.relationshipIndex?.state!==state){
      const fields=new Map<string,Map<string,Set<string>>>();
      for(const field of ['status','source','target','themeIds']){
        const values=new Map<string,Set<string>>();fields.set(field,values);
        for(const row of state.rows.values())for(const value of field==='themeIds'?(Array.isArray(row.data.themeIds)?row.data.themeIds:[]):[row.data[field]]){
          if(typeof value!=='string')continue;const ids=values.get(value)??new Set<string>();ids.add(row.id);values.set(value,ids);
        }
      }
      this.relationshipIndex={state,fields,sorted:[...state.rows.keys()].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))};
    }
    const index=this.relationshipIndex;let selected:Set<string>|undefined;
    const intersect=(ids:Set<string>)=>{selected=selected?new Set([...selected].filter(id=>ids.has(id))):ids;};
    if(query.status)intersect(index.fields.get('status')!.get(query.status)??new Set());
    if(query.theme)intersect(index.fields.get('themeIds')!.get(query.theme)??new Set());
    if(query.companyIds || query.exactIds){const ids=new Set(query.exactIds);for(const company of query.companyIds??[])for(const field of ['source','target'])for(const id of index.fields.get(field)!.get(company)??[])ids.add(id);intersect(ids);}
    if(query.prefix!==undefined){const lower=Buffer.from(query.prefix),upper=Buffer.from(`${query.prefix}\uf8ff`);let lo=0,hi=index.sorted.length;while(lo<hi){const mid=(lo+hi)>>>1;if(Buffer.compare(Buffer.from(index.sorted[mid]),lower)<0)lo=mid+1;else hi=mid;}
      const ids=new Set<string>();for(let i=lo;i<index.sorted.length && ids.size<(query.limit??100);i++){const id=index.sorted[i];if(Buffer.compare(Buffer.from(id),upper)>=0)break;ids.add(id);}intersect(ids);
    }
    return [...(selected??state.rows.keys())].flatMap(id=>{const row=state.rows.get(id);return row?[row]:[];});
  }
  stats(){return {ready:this.states.size===3,counts:Object.fromEntries([...this.states].map(([name,state])=>[name,state.rows.size])),memory:process.memoryUsage()};}
}
