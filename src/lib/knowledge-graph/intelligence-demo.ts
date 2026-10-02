import type { KnowledgeGraph } from './model';

// Deliberately isolated presentation fixtures. These are not market observations.
const companies = [
  ['NVDA','NVIDIA','compute'],['AMD','Advanced Micro Devices','compute'],['INTC','Intel','compute'],['QCOM','Qualcomm','compute'],
  ['MU','Micron','memory'],['WDC','Western Digital','memory'],['STX','Seagate','memory'],['SKH','SK hynix','memory'],
  ['TSM','TSMC','foundry'],['ASML','ASML','equipment'],['AMAT','Applied Materials','equipment'],['LRCX','Lam Research','equipment'],['KLAC','KLA','equipment'],['ARM','Arm','design'],['SNPS','Synopsys','design'],['CDNS','Cadence','design'],
  ['AVGO','Broadcom','networking'],['ANET','Arista Networks','networking'],['CSCO','Cisco','networking'],['MRVL','Marvell','networking'],['COHR','Coherent','optics'],['LITE','Lumentum','optics'],
  ['DELL','Dell','servers'],['SMCI','Super Micro','servers'],['HPE','Hewlett Packard Enterprise','servers'],['HPQ','HP','edge'],['AAPL','Apple','edge'],
  ['VRT','Vertiv','cooling'],['ETN','Eaton','power'],['GEV','GE Vernova','energy'],['CEG','Constellation Energy','energy'],['EQIX','Equinix','datacenters'],['DLR','Digital Realty','datacenters'],
  ['MSFT','Microsoft','cloud'],['AMZN','Amazon','cloud'],['GOOGL','Alphabet','cloud'],['META','Meta','cloud'],['ORCL','Oracle','cloud'],['CRWV','CoreWeave','cloud'],
  ['PLTR','Palantir','applications'],['CRM','Salesforce','applications'],['NOW','ServiceNow','applications'],['ADBE','Adobe','applications'],['SNOW','Snowflake','applications'],
] as const;
const eventFixtures = [
  {id:'amd-rack',time:'10:03',minute:33,origin:'US:AMD',category:'PRODUCT',title:'AMD / next-generation rack architecture',targets:['MU','TSM','AVGO','ANET'],signals:37,sources:6,summary:'Illustrative architecture announcement. Memory, fabrication and networking companies provide research paths from AMD.',why:['High-bandwidth memory integration','Advanced-node manufacturing','Scale-up interconnect','Data center networking']},
  {id:'micron-hbm',time:'10:31',minute:61,origin:'US:MU',category:'CAPACITY',title:'Micron / HBM capacity expansion',targets:['AMD','NVDA','AMAT'],signals:21,sources:4,summary:'Illustrative capacity update. Explore accelerator demand and the equipment needed to expand memory production.',why:['Accelerator memory demand','Accelerator memory demand','Memory manufacturing equipment']},
  {id:'nvidia-network',time:'11:05',minute:95,origin:'US:NVDA',category:'PRODUCT',title:'NVIDIA / AI networking platform',targets:['ANET','AVGO','TSM','DELL'],signals:28,sources:5,summary:'Illustrative networking announcement connecting compute, interconnect, fabrication and server integration.',why:['AI network deployment','Interconnect ecosystem','Chip fabrication','Server integration']},
  {id:'cloud-capacity',time:'11:42',minute:132,origin:'US:MSFT',category:'INFRASTRUCTURE',title:'Microsoft / AI cloud infrastructure',targets:['NVDA','VRT','ETN','EQIX'],signals:16,sources:3,summary:'Illustrative infrastructure investment update. Follow compute, power, cooling and data center research paths.',why:['Accelerator infrastructure','Thermal management','Electrical infrastructure','Data center capacity']},
];
export const demoSourceNames = ['SEC','IR','News','X','GitHub','Reddit'] as const;
export type DemoSource = typeof demoSourceNames[number];
const sourceCounts: Record<string, Record<DemoSource, number>> = {
  'amd-rack': {SEC:2,IR:5,News:8,X:15,GitHub:4,Reddit:3},
  'micron-hbm': {SEC:1,IR:3,News:6,X:11,GitHub:0,Reddit:0},
  'nvidia-network': {SEC:2,IR:4,News:8,X:10,GitHub:4,Reddit:0},
  'cloud-capacity': {SEC:0,IR:4,News:5,X:7,GitHub:0,Reddit:0},
};
export const demoEvents = eventFixtures.map(event=>({...event,sourceCounts:sourceCounts[event.id]}));
export const demoGraph: KnowledgeGraph = {
  asOf:'2026-10-02',sources:[],
  nodes:companies.map(([symbol,name,stage],order)=>({id:`US:${symbol}`,kind:'COMPANY',name,symbol,market:'US',order,stageIds:[stage]})),
  relationships:demoEvents.flatMap(event=>event.targets.map((symbol,i)=>({id:`${event.id}:${symbol}`,source:event.origin,target:`US:${symbol}`,type:'ECOSYSTEM_PARTNER_OF',summary:`Simulated research relevance: ${event.why[i]}.`,sourceIds:[],commercialStatus:'DEMO'}))),
};
