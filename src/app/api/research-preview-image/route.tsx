import { ImageResponse } from "next/og";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { companyName } from "@/lib/knowledge-graph/model";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const raw = q.get("company") ?? "", id = raw.includes(":") ? raw.toUpperCase() : `US:${raw.toUpperCase()}`;
  const graph = /^[A-Z_]+:[A-Z0-9.-]{1,20}$/.test(id) ? await loadKnowledgeGraph().catch(()=>null) : null;
  const company = graph?.nodes.find(n=>n.kind==="COMPANY"&&n.id===id);
  const edges = company ? graph!.relationships.filter(e=>e.type!=="PARTICIPATES_IN"&&(e.source===id||e.target===id)&&(!q.get("relationship")||e.id===q.get("relationship"))).slice(0,3) : [];
  const name = (nodeId:string) => {const n=graph?.nodes.find(n=>n.id===nodeId);return n?companyName(n,"en"):nodeId;};
  return new ImageResponse(<div style={{display:"flex",flexDirection:"column",background:"#081522",color:"#e5f3ff",padding:54,width:"100%",height:"100%",fontFamily:"sans-serif"}}><div style={{display:"flex",color:"#67e8f9",fontSize:28}}>YouAnalyst · AI supply-chain research</div><div style={{display:"flex",fontSize:48,marginTop:35}}>{company?companyName(company,"en").slice(0,60):"Explore the companies behind AI"}</div><div style={{display:"flex",fontSize:25,color:"#abc5d7",marginTop:20}}>Company roles · Documented connections · Original evidence</div><div style={{display:"flex",flexDirection:"column",gap:20,fontSize:26,marginTop:45}}>{edges.map(e=><div style={{display:"flex"}} key={e.id}>{name(e.source).slice(0,24)} · {(relationLabels[e.type]?.[0]??e.type).replace(/[↔→←]/g,"").trim()} · {name(e.target).slice(0,24)}</div>)}</div><div style={{display:"flex",marginTop:"auto",fontSize:22,color:"#abc5d7"}}>{company&&graph?.asOf?`Graph snapshot ${graph.asOf.slice(0,10)} · Inspect each source` : "Follow a company. Understand its connections."}</div></div>,{width:1200,height:630});
}
