export type LabelBox = { left:number; top:number; right:number; bottom:number; width:number; height:number };
export type LabelOffset = { x:number; y:number };

/** Keep labels clear of headings; active tour representatives can dock at an edge. */
export function placeTreeLabel(box:LabelBox, occupied:LabelBox[], viewport:LabelBox, preferred:LabelOffset={x:0,y:0},edgePinned=false) {
  const step=box.height+10;
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
  const edge={x:clamp(box.left,viewport.left+12,viewport.right-12-box.width)-box.left,y:clamp(box.top,viewport.top+16,viewport.bottom-16-box.height)-box.top};
  const candidates=[preferred,{x:0,y:0},...[-1,1,-2,2].map(row=>({x:0,y:row*step})),...(edgePinned?[edge,...[-1,1,-2,2].map(row=>({x:edge.x,y:edge.y+row*step}))]:[])];
  for(const offset of candidates){
    if(!edgePinned&&Math.abs(offset.y)>90)continue;
    // DOMRect dimensions are prototype getters, so object spread loses them.
    const next={width:box.width,height:box.height,left:box.left+offset.x,right:box.right+offset.x,top:box.top+offset.y,bottom:box.bottom+offset.y};
    if(next.left<viewport.left+12||next.right>viewport.right-12||next.top<viewport.top+16||next.bottom>viewport.bottom-16)continue;
    if(occupied.some(r=>next.left<r.right+8&&next.right>r.left-8&&next.top<r.bottom+8&&next.bottom>r.top-8))continue;
    return {...offset,box:next};
  }
  return null;
}
