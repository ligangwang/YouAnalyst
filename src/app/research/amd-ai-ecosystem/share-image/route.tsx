import { ImageResponse } from "next/og";
import { researchFilters, selectedConnections, researchCompanies, REVIEWED } from "@/lib/research/amd-ecosystem";
export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const {product,kind} = researchFilters(query.get("product") ?? undefined, query.get("kind") ?? undefined);
  const rows = selectedConnections(product,kind);
  const selected = researchCompanies.find(c=>`US:${c.symbol}`===query.get("company")&&(c.symbol==="AMD"||rows.some(r=>r.symbol===c.symbol)));
  return new ImageResponse(
    <div style={{display:"flex",flexDirection:"column",background:"#081522",color:"#e5f3ff",padding:54,width:"100%",height:"100%",fontFamily:"sans-serif"}}>
      <div style={{display:"flex",color:"#67e8f9",fontSize:28}}>YouAnalyst · Evidence-led research</div>
      <div style={{display:"flex",fontSize:48,marginTop:26}}>AMD AI ecosystem{selected&&selected.symbol!=="AMD"?` · ${selected.name.en}`:""}</div>
      <div style={{display:"flex",fontSize:26,color:"#abc5d7",marginTop:14}}>{product==="all"?"EPYC · Instinct · Helios":product} · {kind==="all"?"Suppliers, integrations and plans":kind}</div>
      <div style={{display:"flex",flexDirection:"column",fontSize:25,gap:14,marginTop:30}}>
        {rows.slice(0,5).map(row=><div key={row.id} style={{display:"flex"}}>{row.label.en}</div>)}
        {!rows.length && <div style={{display:"flex"}}>No curated connections match these filters</div>}
      </div>
      <div style={{display:"flex",marginTop:"auto",fontSize:22,color:"#abc5d7"}}>Evidence reviewed {REVIEWED} · Announcements ≠ deployments</div>
    </div>, {width:1200,height:630});
}
