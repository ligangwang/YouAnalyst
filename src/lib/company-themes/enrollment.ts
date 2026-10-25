import {exchangeRegion} from '../market-companies/exchange-region';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {activeThemeIds,type CompanyThemeId,type ThemedCompany} from './model';
import {catalogGraphSectors} from './catalog-graph';
import {catalogThemeIds,type ThemeCatalog} from './catalog-model';

export type EnrollmentBatch = {theme:CompanyThemeId; reviewedAt:string; companies:{
  id:string; expectedName:string; primarySector:string; secondaryRoles?:string[]; aiStageIds?:string[];
  sources:{url:string; title:string; summary:string}[];
}[]};

/** Existing canonical profiles only; never replace an editorial decision or relationship. */
export function planEnrollment(records:ThemedCompany[], batch:EnrollmentBatch,catalog:ThemeCatalog) {
  assert(catalogThemeIds(catalog).includes(batch.theme),'Unknown theme');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.reviewedAt)&&new Date(batch.reviewedAt).toISOString().slice(0,10)===batch.reviewedAt&&batch.reviewedAt<=new Date().toISOString().slice(0,10),'Invalid review date');
  assert(batch.companies.length>0&&batch.companies.length<=100,'Invalid batch size');
  assert(new Set(batch.companies.map(row=>row.id)).size===batch.companies.length,'Duplicate identity');
  return batch.companies.flatMap(proposal=>{
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(proposal.id),'Invalid canonical identity');
    const record=records.find(row=>row.id===proposal.id);
    assert(record&&record.name===proposal.expectedName&&['PUBLISHED','DIRECTORY'].includes(String(record.status)),`${proposal.id}: missing canonical profile or identity changed`);
    const sectors=catalogGraphSectors(catalog,batch.theme),sector=sectors.find(row=>row.id===proposal.primarySector || row.stages.includes(proposal.primarySector));
    assert(sector,'Unknown primary sector');
    const normalizeRole=(id:string)=>id.startsWith(batch.theme+'.')||id.startsWith(batch.theme+':')?id.slice(batch.theme.length+1):id;
    const primarySector=normalizeRole(proposal.primarySector);
    const secondary=(proposal.secondaryRoles??[]).map(normalizeRole);
    assert(new Set(secondary).size===secondary.length&&!secondary.includes(primarySector)&&secondary.every(id=>sectors.some(row=>row.id===id || row.stages.includes(id) || row.stages.includes(`${batch.theme}:${id}`))),'Invalid secondary sectors');
    assert(proposal.sources.length>0,'Reviewed sources required');
    for(const source of proposal.sources){const url=new URL(source.url);assert(url.protocol==='https:'&&!url.username&&!url.password&&source.title.trim()&&source.summary.trim(),'Invalid reviewed source');}
    const membership={status:'PUBLISHED' as const,primarySector,secondaryRoles:secondary,reviewedAt:batch.reviewedAt,sources:proposal.sources};
    const memberships=structuredClone(record.themeMemberships??{});
    assert(!memberships[batch.theme]||isDeepStrictEqual(memberships[batch.theme],membership),`${proposal.id}: existing theme decision conflicts`);
    memberships[batch.theme]=membership;
    const fields:Record<string,unknown>={exchange_region:exchangeRegion(proposal.id),themeMemberships:memberships,themeIds:activeThemeIds({themeMemberships:memberships})};
    if(batch.theme==='ai'){
      // The deployed AI reader uses inGraph; write its projection and the job index atomically.
      const stageIds=proposal.aiStageIds??[sector.stages.find(id=>!/[.:]/.test(id))??sector.stages[0]];
      assert(stageIds.length>0&&new Set(stageIds).size===stageIds.length&&stageIds.every(stage=>[sector,...sectors.filter(row=>secondary.includes(row.id))].some(row=>row.stages.includes(stage))),'Invalid AI stages');
      const sources=proposal.sources.map((source,index)=>({id:`theme:ai:${proposal.id}:${index}`,url:source.url,title:source.title,sourceDate:null}));
      const stages=stageIds.map(stage=>{const node=catalog.find(node=>node.id===stage || node.id.startsWith('ai.')&&node.id.split('.').at(-1)===stage);assert(node,'Missing catalog AI stage');return {id:`stage:${stage}`,kind:'STAGE',order:node.order,label:node.names.en,labels:node.names};});
      const graph={status:'PUBLISHED',stageIds,stages,memberships:stageIds.map(stage=>({id:`theme:ai:${proposal.id}:stage:${stage}`,source:proposal.id,target:`stage:${stage}`,type:'PARTICIPATES_IN',summary:proposal.sources.map(source=>source.summary).join(' '),sourceIds:sources.map(source=>source.id),commercialStatus:'NOT_A_COMMERCIAL_RELATIONSHIP'})),sources,order:1000,asOf:batch.reviewedAt};
      const old=record.inGraph;
      assert(!old||isDeepStrictEqual({...old as object,stages},graph),`${proposal.id}: existing AI map decision conflicts`);
      fields.inGraph=graph;
    }
    if(!record.description)fields.description=proposal.sources.map(source=>source.summary).join(' ');
    // Directory exchange metadata is already verified by the directory job.
    if(record.market==='US'&&record.exchange&&record.symbol&&!record.listingStatus&&!record.listings){fields.listingStatus='PUBLIC';fields.listings=[{market:record.market,exchange:record.exchange,symbol:record.symbol}];}
    return Object.entries(fields).every(([key,value])=>isDeepStrictEqual(record[key],value))?[]:[{id:proposal.id,fields}];
  });
}

