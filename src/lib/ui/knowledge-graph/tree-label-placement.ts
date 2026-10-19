export type LabelBox = { left:number; top:number; right:number; bottom:number; width:number; height:number };
export type LabelOffset = { x:number; y:number };

/** Keep labels clear of headings; active tour representatives can dock at an edge. */
export function placeTreeLabel(box:LabelBox, occupied:LabelBox[], viewport:LabelBox, preferred:LabelOffset={x:0,y:0},edgePinned=false) {
  const step=box.height+10;
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
  const edge={x:clamp(box.left,viewport.left+12,viewport.right-12-box.width)-box.left,y:clamp(box.top,viewport.top+16,viewport.bottom-16-box.height)-box.top};
  // A phone can have several disclosed sectors in a short canvas. Search the
  // remaining edge slots as well so one representative per sector stays readable.
  const edgeSlots=edgePinned?Array.from({length:Math.max(0,Math.floor((viewport.height-32)/step))},(_,row)=>viewport.top+16+row*step-box.top).flatMap(y=>[edge.x,viewport.left+12-box.left,viewport.right-12-box.width-box.left].map(x=>({x,y}))).sort((a,b)=>Math.abs(a.x-edge.x)+Math.abs(a.y-edge.y)-Math.abs(b.x-edge.x)-Math.abs(b.y-edge.y)):[];
  const candidates=[preferred,{x:0,y:0},...[-1,1,-2,2].map(row=>({x:0,y:row*step})),...(edgePinned?[edge,...[-1,1,-2,2].map(row=>({x:edge.x,y:edge.y+row*step})),...edgeSlots]:[])];
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
