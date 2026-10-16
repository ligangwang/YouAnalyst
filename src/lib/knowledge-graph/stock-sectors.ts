import type {GraphNode,KnowledgeGraph} from './model';
import {companySectors} from './views';
import {OTHER_SECTOR} from './sectors';

export type StockSectorGroupId='industry'|'supply-chain'|'business'|'market'|'watchlist';
export type StockSector={id:string;group:StockSectorGroupId;en:string;zh:string;sources:{title:string;url:string}[]};
export const STOCK_SECTOR_GROUPS=[
 {id:'industry',en:'Industry',zh:'行业'},
 {id:'supply-chain',en:'Supply-chain roles',zh:'产业链环节'},
 {id:'business',en:'Business concepts',zh:'业务概念'},
 {id:'market',en:'Listing market',zh:'上市市场'},
 {id:'watchlist',en:'My groups',zh:'我的分组'},
] as const;

const concepts=[
 {id:'hbm',en:'High-bandwidth memory (HBM)',zh:'高带宽内存（HBM）'},
 {id:'dram',en:'DRAM memory',zh:'DRAM 内存'},
 {id:'nand',en:'NAND flash',zh:'NAND 闪存'},
 {id:'enterprise-ssd',en:'Enterprise SSDs',zh:'企业级 SSD'},
 {id:'data-center',en:'Servers & data centers',zh:'服务器与数据中心'},
 {id:'automotive',en:'Automotive memory',zh:'汽车电子存储'},
 {id:'mobile',en:'Mobile memory & storage',zh:'移动终端存储'},
 {id:'client',en:'PC & client memory',zh:'PC 与客户端存储'},
 {id:'industrial',en:'Industrial IoT memory',zh:'工业物联网存储'},
];

// Reviewed 2026-10-16 against the linked company product/market pages.
// Explicit membership avoids treating a product mention, customer relationship,
// or a broad memory stage as proof that a company supplies every memory product.
const businessCoverage:Record<string,{concepts:string[];sources:{title:string;url:string}[]}[]>={
 'US:MU':[
  {concepts:['hbm','dram','nand','enterprise-ssd','client'],sources:[{title:'Micron products',url:'https://www.micron.com/products/'}]},
  {concepts:['data-center','automotive','mobile','industrial'],sources:[{title:'Micron markets & industries',url:'https://www.micron.com/markets-industries'}]},
 ],
 'US:SKHY':[{concepts:['hbm','dram','nand','enterprise-ssd','data-center','automotive','mobile'],sources:[{title:'SK hynix memory solutions at MWC 2026',url:'https://news.skhynix.com/en/mwc-2026/'}]}],
 'ORG:SAMSUNG-ELECTRONICS':[
  {concepts:['hbm','dram','nand','enterprise-ssd','data-center','mobile','client'],sources:[{title:'Samsung memory business',url:'https://semiconductor.samsung.com/about-us/business-area/memory/'}]},
  {concepts:['automotive'],sources:[{title:'Samsung automotive memory',url:'https://semiconductor.samsung.com/automotive-memory/'}]},
 ],
 'US:SNDK':[{concepts:['nand','enterprise-ssd','data-center'],sources:[{title:'Sandisk enterprise SSDs',url:'https://www.sandisk.com/solutions/enterprise-ssds'}]}],
};

export function stockSectors(company:GraphNode,graph:KnowledgeGraph|null|undefined,watchlist:readonly string[]=[]):StockSector[]{
 const sources=(company.sourceIds??[]).flatMap(id=>{
  const source=graph?.sources.find(item=>item.id===id);
  return source?[{title:source.title,url:source.url}]:[];
 });
 const result:StockSector[]=companySectors(company).filter(item=>item.id!==OTHER_SECTOR.id).map(item=>({
  id:'industry:'+item.stages.join('|'),group:'industry',en:item.en,zh:item.zh,sources,
 }));
 for(const id of new Set(company.stageIds??[])){
  const stage=graph?.nodes.find(item=>item.kind==='STAGE'&&item.id==='stage:'+id);
  if(!stage)continue;
  const en=stage.labels?.en??stage.label,zh=stage.labels?.['zh-CN']??stage.label;
  if(en&&zh&&!result.some(item=>item.en===en&&item.zh===zh))result.push({id:'stage:'+id,group:'supply-chain',en,zh,sources});
 }
 for(const concept of concepts){
  const coverage=businessCoverage[company.id]?.filter(item=>item.concepts.includes(concept.id))??[];
  if(coverage.length)result.push({...concept,id:'business:'+concept.id,group:'business',sources:coverage.flatMap(item=>item.sources)});
 }
 const market=company.market;
 if(company.listingStatus!=='PRIVATE'&&(market==='US'||market==='CN_A'))result.push({id:'market:'+market,group:'market',en:market==='US'?'US-listed stocks':'China A-shares',zh:market==='US'?'美股':'中国 A 股',sources:[]});
 // GLOBAL includes private companies and is not a listing market.
 if(watchlist.includes(company.id))result.push({id:'watchlist:saved',group:'watchlist',en:'Watchlist',zh:'自选股',sources:[]});
 return result;
}

export function stockSectorPeers(sector:StockSector,companyId:string,graph:KnowledgeGraph|null|undefined,watchlist:readonly string[]=[]):GraphNode[]{
 return [...new Map((graph?.nodes??[]).filter(node=>node.kind==='COMPANY'&&node.id!==companyId&&stockSectors(node,graph,watchlist).some(item=>item.id===sector.id)).map(node=>[node.id,node])).values()];
}
