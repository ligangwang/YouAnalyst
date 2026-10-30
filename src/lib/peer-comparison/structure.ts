import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../knowledge-graph/model';
import {loadThemeGraphStructure} from '../company-themes/graph-service';
import {localEntityVersions} from '../local-cache/entities';
import {companyDirectoryVersion} from '../local-cache/company-directory';
import {PeerStructureCache} from './structure-cache';

declare global {var __peerStructuresV1:WeakMap<Firestore,PeerStructureCache<KnowledgeGraph>>|undefined;}
const caches=globalThis.__peerStructuresV1??=new WeakMap();
export function loadPeerStructure(db:Firestore,theme:string){
 let cache=caches.get(db);if(!cache){cache=new PeerStructureCache();caches.set(db,cache);}
 const version=()=>{
  const live=localEntityVersions(db);
  // Broad enrollment uses the projected file; targeted neighbors/edges use push caches.
  return JSON.stringify([live.companies,live.company_relationships,companyDirectoryVersion(db)]);
 };
 return cache.load(theme,version,async()=>{
  const graph=await loadThemeGraphStructure(theme);
  // Comparisons need identities and recorded sectors, not edge evidence or layout.
  return {nodes:graph.nodes.filter(node=>node.kind==='COMPANY').map(({id,kind,name,names,symbol,slug,listingStatus,stageIds,themeSectors,order})=>
   ({id,kind,name,names,symbol,slug,listingStatus,stageIds,themeSectors,order})),relationships:[],sources:[],asOf:graph.asOf};
 });
}
