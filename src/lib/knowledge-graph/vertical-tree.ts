import { companyName } from './model';
import type { TreeLayer, TreePoint } from './industry-tree';

export const VERTICAL_ROOT_REACH=2100;
export const VERTICAL_ROOT_DEPTH=320;

// Each layer owns a vertical band. The companies form a leaf cluster around
// their branch rather than a long column of labels beside the trunk.
export function layoutVerticalTree(layers:TreeLayer[],open:ReadonlySet<string>,locale:string):TreePoint[] {
  const nodes:TreePoint[]=[{id:'root',kind:'root',label:locale==='zh-CN'?'AI 产业链':'AI industry chain',color:'#8be8ff',position:[0,0,0]}];
  if(!open.has('root'))return nodes;
  let bottom=260;
  layers.forEach((layer,index)=>{
    const side=index%2===0?1:-1;
    const crown=layer.id==='applications';
    const expanded=open.has(layer.id);
    const height=expanded?Math.max(430,layer.branches.length*90+130):430;
    const y=bottom+height/2;
    nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:locale==='zh-CN'?layer.zh:layer.en,color:layer.color,position:[crown?0:side*520,y,0],count:layer.companies.length});
    if(expanded)layer.branches.forEach((branch,i)=>{
      const by=crown?y+300:bottom+height-100-i*90;
      const spread=Math.abs(i-(layer.branches.length-1)/2);
      const branchX=crown?(i-(layer.branches.length-1)/2)*800:side*(1250-spread*80);
      const leafSide=Math.sign(branchX)||side;
      nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:locale==='zh-CN'?branch.zh:branch.en,color:layer.color,position:[branchX,by,0],count:branch.companies.length});
      if(open.has(branch.id))[...branch.companies].sort((a,b)=>a.id.localeCompare(b.id)).forEach((company,j)=>{
        const angle=j*2.399963229728653;
        const radius=45+Math.sqrt(j+1)*32;
        nodes.push({id:`${branch.id}/${company.id}`,parent:branch.id,layer:layer.id,branch:branch.id,kind:'company',label:companyName(company,locale),color:layer.color,position:[branchX+leafSide*(280+radius*1.05*Math.cos(angle)),by+(crown?250:0)+radius*Math.sin(angle),0],company});
      });
    });
    bottom+=height+90;
  });
  return nodes;
}
