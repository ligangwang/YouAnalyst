import type { KnowledgeGraph } from "./model";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "./sectors";

// Stable sector neighborhoods with gentle depth keep the initial view readable.
export function layout3D(graph: KnowledgeGraph) {
  const companies = graph.nodes.filter(n => n.kind === "COMPANY");
  const groups = [...GRAPH_SECTORS, OTHER_SECTOR].map(sector => ({sector, companies: companies.filter(n => companySector(n).id === sector.id).sort((a,b) => a.id.localeCompare(b.id))})).filter(g => g.companies.length);
  const columns = Math.min(3, groups.length);
  const widths = Array.from({length: columns}, (_, col) => Math.max(...groups.filter((_,i) => i % columns === col).map(g => Math.ceil(Math.sqrt(g.companies.length)) * 85 + 100)));
  const heights = Array.from({length: Math.ceil(groups.length / Math.max(1,columns))}, (_, row) => Math.max(...groups.slice(row*columns,(row+1)*columns).map(g => Math.ceil(g.companies.length / Math.ceil(Math.sqrt(g.companies.length))) * 75 + 110)));
  const nodes = groups.flatMap((group,index) => {
    const col = index % columns, row = Math.floor(index / columns);
    const cx = widths.slice(0,col).reduce((a,b)=>a+b,0) + widths[col]/2;
    const cy = -(heights.slice(0,row).reduce((a,b)=>a+b,0) + heights[row]/2);
    const count = Math.ceil(Math.sqrt(group.companies.length));
    return group.companies.map((node,i) => ({...node,x: cx + (i % count - (count-1)/2)*85,y: cy - (Math.floor(i/count) - (Math.ceil(group.companies.length/count)-1)/2)*75,z: Math.sin(i*2.4+index)*30}));
  });
  const center = nodes.reduce((p,n)=>[p[0]+n.x,p[1]+n.y,p[2]+n.z],[0,0,0]).map(v=>v/Math.max(1,nodes.length));
  nodes.forEach(n=>{n.x-=center[0];n.y-=center[1];n.z-=center[2];});
  const ids = new Set(nodes.map(n=>n.id));
  const edges = graph.relationships.filter(e=>e.type!=="PARTICIPATES_IN" && ids.has(e.source) && ids.has(e.target));
  return {nodes, edges, radius:Math.max(60,...nodes.map(n=>Math.hypot(n.x,n.y,n.z)))};
}
