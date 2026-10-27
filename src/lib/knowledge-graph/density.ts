/** Select a stable, bounded set of screen-space points for a crowded view. */
export function densitySelection(points: readonly {id:string;x:number;y:number;depth:number;priority:number}[], width:number, height:number, cellSize=36, limit=240): string[] {
  const ordered=[...points].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<width&&p.y<height)
    .sort((a,b)=>b.priority-a.priority || a.depth-b.depth || a.id.localeCompare(b.id));
  const occupied=new Set<string>(), chosen:string[]=[];
  for(const p of ordered){
    const cell=`${Math.floor(p.x/cellSize)}:${Math.floor(p.y/cellSize)}`;
    if(p.priority<3 && (occupied.has(cell)||chosen.length>=limit))continue;
    occupied.add(cell);chosen.push(p.id);
  }
  return chosen.sort();
}
