export type LabelBox = { left:number; top:number; right:number; bottom:number; width:number; height:number };
export type LabelOffset = { x:number; y:number };

/** Keep labels near their stems, inside the canvas and clear of reserved headings. */
export function placeTreeLabel(box:LabelBox, occupied:LabelBox[], viewport:LabelBox, preferred:LabelOffset={x:0,y:0}) {
  const step=box.height+10;
  const candidates=[preferred,{x:0,y:0},...[-1,1,-2,2].map(row=>({x:0,y:row*step}))];
  for(const offset of candidates){
    if(Math.abs(offset.y)>90)continue;
    // DOMRect dimensions are prototype getters, so object spread loses them.
    const next={width:box.width,height:box.height,left:box.left+offset.x,right:box.right+offset.x,top:box.top+offset.y,bottom:box.bottom+offset.y};
    if(next.left<viewport.left+12||next.right>viewport.right-12||next.top<viewport.top+16||next.bottom>viewport.bottom-16)continue;
    if(occupied.some(r=>next.left<r.right+8&&next.right>r.left-8&&next.top<r.bottom+8&&next.bottom>r.top-8))continue;
    return {...offset,box:next};
  }
  return null;
}
