import type {KnowledgeGraph} from '../knowledge-graph/model';
import {peerGroup} from './model';
type PeerThemeCompany={themeIds?:readonly string[];themeMemberships?:Record<string,{status?:string}>};

/** Non-AI graphs contain published direct members only. AI also retains
 * relationship-only neighbors, so it must remain eligible without a membership. */
export async function findPeerThemeGroup(companyId:string,company:PeerThemeCompany|undefined,
 themes:readonly string[],loadGraph:(theme:string)=>Promise<KnowledgeGraph|null>){
 for(const theme of themes){
  if(theme!=='ai'&&(!company?.themeIds?.includes(theme)||company.themeMemberships?.[theme]?.status!=='PUBLISHED'))continue;
  const graph=await loadGraph(theme);if(!graph)continue;
  const group=peerGroup(companyId,graph.nodes);
  if(group)return {graph,group};
 }
 return null;
}
