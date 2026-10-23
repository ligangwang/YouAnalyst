import type { KnowledgeGraph } from '../knowledge-graph/model';
import { OTHER_SECTOR, type GraphSector } from '../knowledge-graph/sectors';
import type { ThemeCatalog } from './catalog-model';

const colors=['#65d9ff','#c4a0ff','#67e6bc','#ffc57a','#8faaff','#ff9eae','#e3a2ef','#f4eb87'];
export function catalogGraphSectors(nodes:ThemeCatalog,theme:string):GraphSector[]{
  const index=new Map(nodes.map(node=>[node.id,node]));
  const ancestors=new Map(nodes.map(node=>{const path=new Set<string>();let current:typeof node|undefined=node;while(current&&!path.has(current.id)){path.add(current.id);current=current.parentId?index.get(current.parentId):undefined;}return [node.id,path];}));
  const children=nodes.filter(node=>node.parentId===theme);
  const roots=children.length?children:nodes.filter(node=>node.id===theme);
  return roots.map((node,index)=>{
    const descendants=nodes.filter(item=>ancestors.get(item.id)?.has(node.id));
    return {id:node.id.startsWith(theme+'.')?node.id.slice(theme.length+1):node.id,
      order:node.order,en:node.names.en,zh:node.names['zh-CN'],color:colors[index%colors.length],
      branches:nodes.filter(child=>child.parentId===node.id).map(child=>({id:child.id,order:child.order,en:child.names.en,zh:child.names['zh-CN'],stages:nodes.filter(item=>ancestors.get(item.id)?.has(child.id)).flatMap(item=>[item.id,`${theme}:${item.id.startsWith(theme+'.')?item.id.slice(theme.length+1):item.id}`,...(theme==='ai'?[item.id.split('.').at(-1)!]:[])])})),
      stages:[...new Set(descendants.flatMap(item=>[item.id,`${theme}:${item.id.startsWith(theme+'.')?item.id.slice(theme.length+1):item.id}`,
        // AI's historical stage IDs are kept verbatim; only their presentation changes.
        ...(theme==='ai'?[item.id.split('.').at(-1)!]:[])]))]};
  });
}
/** Presentation metadata is attached to the response, never persisted on companies. */
export function applyThemeCatalog(graph:KnowledgeGraph,theme:string,nodes:ThemeCatalog):KnowledgeGraph{
  const sectors=catalogGraphSectors(nodes,theme);
  const firstCompany=graph.nodes.find(node=>node.kind==='COMPANY');
  return {...graph,nodes:graph.nodes.map(node=>{
    if(node.kind==='COMPANY'){
      const assigned=sectors.filter(sector=>sector.stages.some(stage=>node.stageIds?.includes(stage))).map(sector=>({...sector,
        stages:sector.stages.filter(stage=>node.stageIds?.includes(stage)),
        branches:sector.branches?.map(branch=>({...branch,stages:branch.stages.filter(stage=>node.stageIds?.includes(stage))})).filter(branch=>branch.stages.length),
      }));
      return {...node,themeId:theme,themeNames:nodes.find(item=>item.id===theme)?.names,
        // Carry the definitions once so empty AI layers remain browsable. Membership
        // still comes exclusively from each company's recorded stage IDs.
        themeSectors:[...(node===firstCompany?sectors:assigned),...(!assigned.length?[{...OTHER_SECTOR,order:2001,stages:node.stageIds??[]}]:[])]};
    }
    const stage=node.id.replace(/^stage:/,'');
    const definition=nodes.find(item=>item.id===stage || item.id===stage.replace(':','.') ||
      theme==='ai' && item.id.startsWith('ai.') && item.id.split('.').at(-1)===stage);
    return definition?{...node,label:definition.names.en,labels:definition.names}:node;
  })};
}
