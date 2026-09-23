import { companyName } from './model';
import type { TreeLayer, TreePoint } from './industry-tree';

// Each layer owns a vertical band. Opening descendants grows that band instead
// of overlapping another layer. Five sibling limbs alternate around one trunk.
export function layoutVerticalTree(layers:TreeLayer[],open:ReadonlySet<string>,locale:string):TreePoint[] {
  const nodes:TreePoint[]=[{id:'root',kind:'root',label:locale==='zh-CN'?'AI 产业链':'AI industry chain',color:'#8be8ff',position:[0,0,0]}];
  if(!open.has('root'))return nodes;
  let bottom=160;
  layers.forEach((layer,index)=>{
    const side=index%2===0?1:-1;
    const expanded=open.has(layer.id);
    const heights=expanded?layer.branches.map(b=>open.has(b.id)?Math.max(120,b.companies.length*74+28):120):[];
    const height=Math.max(220,heights.reduce((a,b)=>a+b,0)+80);
    const y=bottom+height/2;
    nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:locale==='zh-CN'?layer.zh:layer.en,color:layer.color,position:[side*210,y,0],count:layer.companies.length});
    let top=bottom+height-40;
    if(expanded)layer.branches.forEach((branch,i)=>{
      const by=top-heights[i]/2;top-=heights[i];
      nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:locale==='zh-CN'?branch.zh:branch.en,color:layer.color,position:[side*560,by,0],count:branch.companies.length});
      if(open.has(branch.id))[...branch.companies].sort((a,b)=>a.id.localeCompare(b.id)).forEach((company,j)=>nodes.push({id:`${branch.id}/${company.id}`,parent:branch.id,layer:layer.id,branch:branch.id,kind:'company',label:companyName(company,locale),color:layer.color,position:[side*960,by+(branch.companies.length-1)*37-j*74,0],company}));
    });
    bottom+=height+50;
  });
  return nodes;
}
