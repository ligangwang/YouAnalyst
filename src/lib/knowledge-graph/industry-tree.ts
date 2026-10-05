import type { GraphNode } from './model';
import { ROBOTICS_GRAPH_SECTORS } from './sectors';

// Five-layer framework: https://blogs.nvidia.com/blog/ai-5-layer-cake/
// Subdivisions are our industry-role mapping, not a standard sector taxonomy.
export const INDUSTRY_LAYERS = [
  {id:'energy', en:'Energy', zh:'能源', color:'#f4db7c', stages:['energy']},
  {id:'chips', en:'Chips', zh:'芯片', color:'#9bb5ff', stages:['compute','memory','materials','equipment','design','foundry','packaging']},
  {id:'infrastructure', en:'Infrastructure', zh:'基础设施', color:'#67e6bc', stages:['servers','interconnect','optics','boards','networking','power','cooling','datacenters','cloud']},
  {id:'models', en:'Models', zh:'模型', color:'#e3a2ef', stages:['models']},
  {id:'applications', en:'Applications', zh:'应用', color:'#ff9eae', stages:['applications','edge']},
];
const stageNames: Record<string,[string,string]> = {
  energy:['Energy supply','能源供应'], compute:['AI accelerators & CPUs','AI 加速器与处理器'], memory:['Memory & storage','内存与存储'],
  materials:['Semiconductor materials','半导体材料'], equipment:['Manufacturing equipment','制造设备'], design:['EDA & semiconductor IP','EDA 与半导体 IP'],
  foundry:['Wafer fabrication','晶圆制造'], packaging:['Advanced packaging & test','先进封装与测试'], servers:['Servers & systems','服务器与系统'],
  interconnect:['Electrical interconnects','高速电互连'], optics:['Optical communications','光通信'], boards:['PCBs & substrates','PCB 与基板'],
  networking:['Network equipment & silicon','网络设备与芯片'], power:['Power delivery','供配电'], cooling:['Cooling & thermal management','散热与液冷'],
  datacenters:['Data-center facilities','数据中心设施'], cloud:['Cloud compute & platforms','云算力与平台'], models:['Foundation models','基础模型'],
  applications:['AI software & applications','AI 软件与应用'], edge:['Edge AI & devices','端侧 AI 与设备'], other:['Unclassified roles','待分类业务'],
};
// Explicit model-development roles; cloud membership alone is insufficient.
// Sources: openai.com, anthropic.com, mistral.ai, deepmind.google/models,
// ai.meta.com/llama, aws.amazon.com/ai/generative-ai/nova, qwen.ai, yiyan.baidu.com.
const modelDevelopers = new Set(['ORG:OPENAI','ORG:ANTHROPIC','ORG:MISTRAL-AI','US:GOOGL','US:META','US:AMZN','US:BABA','US:BIDU']);
export type TreeBranch = {id:string; en:string; zh:string; companies:GraphNode[]};
export type TreeLayer = typeof INDUSTRY_LAYERS[number] & {branches:TreeBranch[]; companies:GraphNode[]};
export function industryTree(companies:GraphNode[]):TreeLayer[] {
  const unique=[...new Map(companies.map(c=>[c.id,c])).values()];
  if (unique.some(company => company.stageIds?.some(stage => stage.startsWith('robotics:')))) {
    return ROBOTICS_GRAPH_SECTORS.map(sector => {
      const members = unique.filter(company => sector.stages.some(stage => company.stageIds?.includes(stage)));
      return {id:`robotics:${sector.id}`,en:sector.en,zh:sector.zh,color:sector.color,stages:sector.stages,companies:members,
        branches:members.length ? [{id:`robotics:${sector.id}/companies`,en:'Companies',zh:'公司',companies:members}] : []};
    }).filter(layer => layer.companies.length);
  }
  const known=new Set(INDUSTRY_LAYERS.flatMap(l=>l.stages));
  return INDUSTRY_LAYERS.map(layer=>{
    const stages=layer.id==='applications'?[...layer.stages,'other']:layer.stages;
    const branches=stages.map(stage=>({id:`${layer.id}/${stage}`,en:stageNames[stage][0],zh:stageNames[stage][1],companies:unique.filter(c=>
      stage==='models' ? modelDevelopers.has(c.id)||c.stageIds?.includes('models') :
      stage==='other' ? !c.stageIds?.some(s=>known.has(s))&&!modelDevelopers.has(c.id) : c.stageIds?.includes(stage)
    )})).filter(b=>b.companies.length);
    return {...layer,branches,companies:[...new Map(branches.flatMap(b=>b.companies).map(c=>[c.id,c])).values()]};
  });
}
export const industryRootLabel = (layers: TreeLayer[], locale: string) => layers.some(layer => layer.id.startsWith('robotics:')) ? locale === 'zh-CN' ? '机器人产业' : 'Robotics industry' : locale === 'zh-CN' ? 'AI 产业链' : 'AI industry chain';
export type TreePoint={id:string;parent?:string;layer?:string;branch?:string;kind:'root'|'layer'|'branch'|'company';label:string;color:string;position:[number,number,number];planar?:[number,number,number];azimuth?:number;pivotX?:number;company?:GraphNode;count?:number;span?:[number,number];stem?:number};
export function layoutIndustryTree(layers:TreeLayer[],open:ReadonlySet<string>,locale:string):TreePoint[] {
  const label=(n:{en:string;zh:string})=>locale==='zh-CN'?n.zh:n.en;
  const nodes:TreePoint[]=[{id:'root',kind:'root',label:industryRootLabel(layers,locale),color:'#8be8ff',position:[-540,0,0]}];
  if(!open.has('root'))return nodes;
  let bottom=0;
  for(const layer of layers){
    const expanded=open.has(layer.id);
    // Each child owns a vertical interval sized to its visible descendants.
    // Siblings share one column; opening a subtree pushes adjacent layers away.
    // A collapsed branch is one label tall, so a tree opened one level deep stays compact enough to read.
    const heights=expanded?layer.branches.map(b=>open.has(b.id)?Math.max(140,b.companies.length*92+40):72):[];
    const height=Math.max(135,heights.reduce((a,b)=>a+b,0)+60);
    const top=bottom+height;
    nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[-240,bottom+height/2,0],count:layer.companies.length});
    if(expanded)layer.branches.forEach((branch,i)=>{
      const x=100,y=top-30-heights.slice(0,i).reduce((a,b)=>a+b,0)-heights[i]/2,z=0;
      nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:label(branch),color:layer.color,position:[x,y,z],count:branch.companies.length});
      if(open.has(branch.id)) [...branch.companies].sort((a,b)=>a.id.localeCompare(b.id)).forEach((company,j)=>nodes.push({id:`${branch.id}/${company.id}`,parent:branch.id,layer:layer.id,branch:branch.id,kind:'company',label:company.names?.[locale==='zh-CN'?'zh-CN':'en']||company.name||company.id,color:layer.color,position:[x+420,y+(branch.companies.length-1)*46-j*92,z+25],company}));
    });
    bottom=top+35;
  }
  for(const n of nodes)if(n.id!=='root')n.position[1]-=bottom/2;
  return nodes;
}
