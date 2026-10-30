import {setImmediate as yieldToRequests} from 'node:timers/promises';
import type {Firestore, DocumentData} from 'firebase-admin/firestore';
import {companyDirectory,companyDirectoryEnabled,enableCompanyDirectoryForReader,withSharedCompanyQuery,withLiveCompanyReads} from '../local-cache/company-directory';
import {isSupportedCompany} from '../company-support/model';
import {companyClassificationPaths} from '../industry-classification/catalog';
import {companyPageUrl} from '../market-companies/routes';
import {hierarchyPathLookup,type HierarchyNode} from './model';
import {companyThemeNodeIds,type CompanyThemeData} from './company-memberships';
import {catalogThemeIds,isThemeId} from '../company-themes/catalog-model';

export type BrowseKind = 'industries'|'investment-themes';
export type BrowseCompany = {id:string;name:string;href:string;nodeIds:string[]};
export type DirectoryCompany = CompanyThemeData & {id:string;name:string;market?:string;slug?:string;taxonomy?:string;classification?:unknown};
const BATCH_SIZE=128;
const COMMON_FIELDS=['name','slug','market','status','isDeleted','supersededByCompanyId','onboarding.status'];

export function hierarchyCompanyFields(kind:BrowseKind,nodes:HierarchyNode[]) {
  if(kind==='industries')return [...COMMON_FIELDS,'taxonomy','classification'];
  const themes=catalogThemeIds(nodes);
  if(themes.some(id=>!isThemeId(id)))throw Error('Invalid theme ID');
  return [...COMMON_FIELDS,...(themes.includes('ai')?['inGraph.stageIds']:[]),...themes.flatMap(id=>
    ['status','primarySector','secondaryRoles','assignments'].map(field=>`themeMemberships.${id}.${field}`))];
}

/** Project before copying; never expand search indexes or unused evidence. */
function project(id:string,row:DocumentData,fields:string[]):DirectoryCompany {
  const selected:DocumentData=Object.create(null);
  for(const field of fields){
    const parts=field.split('.');let value:unknown=row;
    for(const part of parts)value=value&&typeof value==='object'?(value as DocumentData)[part]:undefined;
    if(value===undefined)continue;
    let target=selected;
    for(const part of parts.slice(0,-1))target=target[part]??=Object.create(null);
    target[parts.at(-1)!]=value;
  }
  return {id,...structuredClone(selected)} as DirectoryCompany;
}

export async function* hierarchyCompanyRows(db:Firestore,kind:BrowseKind,nodes:HierarchyNode[],pause:()=>Promise<unknown>=yieldToRequests):AsyncGenerator<DirectoryCompany> {
  const fields=hierarchyCompanyFields(kind,nodes);
  enableCompanyDirectoryForReader(db);
  const rows=await withSharedCompanyQuery(()=>companyDirectoryEnabled(db)?companyDirectory(db):Promise.resolve(undefined));
  if(rows){
    // Yield even while scanning unsupported rows, retaining a consistent shared
    // directory generation while updates publish a replacement map.
    let count=0;
    const candidates=rows.candidateIds?.('onboarding.status','==','SUPPORTED');
    const selected=candidates?function*(){for(const id of candidates){const row=rows.get(id);if(row)yield [id,row] as const;}}():rows;
    for(const [id,row] of selected){
      if(count++%BATCH_SIZE===0)await pause();
      if(isSupportedCompany(row))yield project(id,row,fields);
    }
  }else{
    // select() cannot be listened to. This fallback reads only projected,
    // supported documents once per refresh, without a collection scan.
    const snapshot=await withLiveCompanyReads(()=>db.collection('companies')
      .where('onboarding.status','==','SUPPORTED').select(...fields).get());
    for(let i=0;i<snapshot.docs.length;i++){
      if(i%BATCH_SIZE===0)await pause();
      const doc=snapshot.docs[i],row=doc.data();
      if(isSupportedCompany(row))yield project(doc.id,row,fields);
    }
  }
}

type Result={items:BrowseCompany[];unavailable:boolean};
type Entry={key:string;value?:Result;expires:number;pending?:Promise<Result>};
type Load=(kind:BrowseKind,nodes:HierarchyNode[])=>AsyncIterable<DirectoryCompany>;

/** Coalesce refreshes per view/catalog and retain only rendered company links. */
export function createHierarchyBrowser(load:Load,now:()=>number=Date.now,pause:()=>Promise<unknown>=yieldToRequests){
  const entries=new Map<BrowseKind,Entry>();
  return async(kind:BrowseKind,nodes:HierarchyNode[]):Promise<Result>=>{
    const key=JSON.stringify(nodes);
    let entry=entries.get(kind);
    if(!entry||entry.key!==key){entry={key,expires:0};entries.set(kind,entry);}
    if(entry.value&&now()<entry.expires)return entry.value;
    if(entry.pending)return entry.pending;
    const current=entry;
    current.pending=(async()=>{
      const ids=new Set(nodes.map(node=>node.id)),path=hierarchyPathLookup(nodes),items:BrowseCompany[]=[];
      for await(const company of load(kind,nodes)){
        if(items.length%BATCH_SIZE===0)await pause();
        const direct=new Set<string>();
        if(kind==='industries'){
          try{companyClassificationPaths(company).forEach(ancestors=>{
            const leaf=ancestors.at(-1);if(leaf)direct.add(`${company.taxonomy}:${leaf.code}`);
          });}catch{/* Invalid legacy classifications must not invent assignments. */}
        }else companyThemeNodeIds(company,nodes,path).forEach(id=>direct.add(id));
        const nodeIds=[...new Set([...direct].filter(id=>ids.has(id)).flatMap(id=>path(id).map(node=>node.id)))];
        items.push({id:company.id,name:company.name,href:companyPageUrl(company.id,company.market,company.slug),nodeIds});
      }
      items.sort((a,b)=>a.id.localeCompare(b.id));
      for(const item of items){Object.freeze(item.nodeIds);Object.freeze(item);}
      Object.freeze(items);
      const result=Object.freeze({items,unavailable:false});
      current.value=result;current.expires=now()+300_000;
      return result;
    })().catch(()=>({items:[],unavailable:true})).finally(()=>{current.pending=undefined;});
    return current.pending;
  };
}
