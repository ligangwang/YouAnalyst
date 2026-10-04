import { ImageResponse } from "next/og";
import { layerNames, researchFilters, selectedConnections, stageNames, REVIEWED } from "@/lib/research/nvidia-ecosystem";
export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const {layer,kind,stage} = researchFilters(query.get("layer") ?? undefined, query.get("kind") ?? query.get("relation") ?? undefined, query.get("stage") ?? undefined);
  const rows = selectedConnections(layer,kind,stage);
  return new ImageResponse(
    <div style={{display:"flex",flexDirection:"column",background:"#081522",color:"#e5f3ff",padding:54,width:"100%",height:"100%",fontFamily:"sans-serif"}}>
      <div style={{display:"flex",color:"#67e8f9",fontSize:28}}>YouAnalyst · Source-based research</div>
      <div style={{display:"flex",fontSize:48,marginTop:26}}>NVIDIA AI ecosystem</div>
      <div style={{display:"flex",fontSize:26,color:"#abc5d7",marginTop:14}}>{layer==="all"?"Chips · Networking · Systems · CUDA · Cloud":layerNames[layer as keyof typeof layerNames].en} · {stage==="all"?"Shipped and announced":stageNames[stage as keyof typeof stageNames].en}</div>
      <div style={{display:"flex",flexDirection:"column",fontSize:25,gap:14,marginTop:30}}>
        {rows.slice(0,5).map(row=><div key={row.id} style={{display:"flex"}}>{row.label.en}</div>)}
        {!rows.length && <div style={{display:"flex"}}>No curated connections match these filters</div>}
      </div>
      <div style={{display:"flex",marginTop:"auto",fontSize:22,color:"#abc5d7"}}>Sources reviewed {REVIEWED} · Announcements ≠ deployments</div>
    </div>, {width:1200,height:630});
}
