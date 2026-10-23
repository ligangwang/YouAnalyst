import type { GraphNode } from "./model";

// Color follows the first recorded industry stage, independent of market/filter order.
export const GRAPH_SECTORS = [
  { id: "semiconductors", color: "#c4a0ff", en: "Semiconductors", zh: "半导体制造", stages: ["materials", "equipment", "design", "foundry", "packaging"] },
  { id: "compute", color: "#65d9ff", en: "AI compute", zh: "AI 算力", stages: ["compute"] },
  { id: "memory", color: "#ffc57a", en: "Memory & storage", zh: "内存与存储", stages: ["memory"] },
  { id: "connectivity", color: "#67e6bc", en: "Connectivity", zh: "通信与互连", stages: ["interconnect", "optics", "boards", "networking"] },
  { id: "systems", color: "#8faaff", en: "Systems & devices", zh: "系统与终端", stages: ["servers", "edge"] },
  { id: "infrastructure", color: "#f4eb87", en: "Energy & infrastructure", zh: "能源与基础设施", stages: ["power", "cooling", "energy", "datacenters"] },
  { id: "platforms", color: "#ff9eae", en: "Cloud & platforms", zh: "云与平台", stages: ["cloud"] },
  { id: "applications", color: "#e3a2ef", en: "AI applications", zh: "AI 应用", stages: ["applications"] },
];
export type GraphSector = {order?:number;id:string;color:string;en:string;zh:string;stages:string[]; branches?:{order?:number;id:string;en:string;zh:string;stages:string[]}[]};
export const ROBOTICS_GRAPH_SECTORS: GraphSector[] = [
  {id:'compute-control',en:'Compute & control',zh:'算力与控制',color:'#65d9ff',stages:['robotics:compute-control']},
  {id:'sensors-vision',en:'Sensors & vision',zh:'传感与视觉',color:'#67e6bc',stages:['robotics:sensors-vision']},
  {id:'motion-mechanics',en:'Motion & mechanics',zh:'运动与机械',color:'#ffc57a',stages:['robotics:motion-mechanics']},
  {id:'grippers-tools',en:'Grippers & tools',zh:'末端执行器与工具',color:'#c4a0ff',stages:['robotics:grippers-tools']},
  {id:'software-simulation',en:'Software & simulation',zh:'软件与仿真',color:'#e3a2ef',stages:['robotics:software-simulation']},
  {id:'robot-manufacturers',en:'Robot manufacturers',zh:'机器人制造商',color:'#8faaff',stages:['robotics:robot-manufacturers']},
  {id:'systems-integration',en:'Systems integration',zh:'系统集成',color:'#ff9eae',stages:['robotics:systems-integration']},
];
export const SPACE_GRAPH_SECTORS: GraphSector[] = [
  {id:'components',en:'Components & subsystems',zh:'零部件与子系统',color:'#c4a0ff',stages:['space:components']},
  {id:'spacecraft',en:'Spacecraft manufacturing',zh:'航天器制造',color:'#65d9ff',stages:['space:spacecraft']},
  {id:'payloads',en:'Payloads & instruments',zh:'载荷与仪器',color:'#ffc57a',stages:['space:payloads']},
  {id:'launch',en:'Launch & transport',zh:'发射与运输',color:'#67e6bc',stages:['space:launch']},
  {id:'ground',en:'Ground systems & terminals',zh:'地面系统与终端',color:'#8faaff',stages:['space:ground']},
  {id:'operators',en:'Satellite operators',zh:'卫星运营',color:'#ff9eae',stages:['space:operators']},
  {id:'applications',en:'Data & applications',zh:'数据与应用',color:'#e3a2ef',stages:['space:applications']},
  {id:'orbital-services',en:'Space infrastructure & services',zh:'空间基础设施与服务',color:'#f4eb87',stages:['space:orbital-services']},
];
export function graphSectors(theme: string = 'ai', companies: Pick<GraphNode,'themeSectors'>[] = []):GraphSector[]{
  if(!companies.some(node=>node.themeSectors))return theme==='space'?SPACE_GRAPH_SECTORS:theme==='robotics'?ROBOTICS_GRAPH_SECTORS:theme==='ai'?GRAPH_SECTORS:[];
  const sectors=new Map<string,GraphSector>();
  for(const company of companies)for(const sector of company.themeSectors??[]){
    const old=sectors.get(sector.id),branches=new Map((old?.branches??[]).map(branch=>[branch.id,branch]));
    for(const branch of sector.branches??[]){const before=branches.get(branch.id);branches.set(branch.id,{...branch,stages:[...new Set([...(before?.stages??[]),...branch.stages])]});}
    sectors.set(sector.id,{...sector,stages:[...new Set([...(old?.stages??[]),...sector.stages])],branches:[...branches.values()].sort((a,b)=>(a.order??0)-(b.order??0))});
  }
  return [...sectors.values()].sort((a,b)=>(a.order??0)-(b.order??0));
}
export const graphTheme = (companies: Pick<GraphNode,'stageIds'|'themeId'>[]) => companies.find(company=>company.themeId)?.themeId ?? (companies.some(company=>company.stageIds?.some(stage=>stage.startsWith('space:'))) ? 'space' : companies.some(company=>company.stageIds?.some(stage=>stage.startsWith('robotics:'))) ? 'robotics' : 'ai');
export const OTHER_SECTOR = { id: "other", color: "#b6c3d2", en: "Other / unclassified", zh: "其他／待分类", stages: [] };
export function companySector(company: Pick<GraphNode, "stageIds"|"themeSectors">) {
  return (company.themeSectors ?? [...GRAPH_SECTORS, ...ROBOTICS_GRAPH_SECTORS, ...SPACE_GRAPH_SECTORS]).find(sector => sector.stages.includes(company.stageIds?.[0] ?? "")) ?? OTHER_SECTOR;
}
/** AI keeps its established primary-sector counts; Robotics exposes reviewed secondary roles. */
export function matchesCompanySector(company: Pick<GraphNode, 'stageIds'|'themeSectors'|'themeId'>, id: string) {
  return company.themeSectors || graphTheme([company]) !== 'ai'
    ? graphSectors(graphTheme([company]),[company]).some(sector => sector.id === id && sector.stages.some(stage => company.stageIds?.includes(stage)))
    : companySector(company).id === id;
}
