import assert from 'node:assert/strict';
import type {ThemedCompany} from './model';
import type {ThemeCatalog} from './catalog-model';
import {catalogGraphSectors} from './catalog-graph';
import type {ThemeAssignment} from './classification';
import {officialSourceUrl,secSourceMatchesIssuer} from './source-url';

export type VerifiedIssuerProfile={companyId:string;cik:string;name:string;industry:string;url:string;checkedAt:string};
/** Facts returned by the issuer's own SEC submissions endpoint, not model memory. */
export function secIssuerProfile(company:ThemedCompany,value:unknown,now=Date.now()):VerifiedIssuerProfile|undefined{
  if(!value||typeof value!=='object'||!company.id.startsWith('US:'))return;
  const row=value as Record<string,unknown>,cik=String(company.cik??'');
  if(!/^\d{1,10}$/.test(cik)||!Number(cik)||Number(row.cik)!==Number(cik)||typeof row.name!=='string'||!row.name.trim()||typeof row.sicDescription!=='string'||!row.sicDescription.trim())return;
  return {companyId:company.id,cik:cik.padStart(10,'0'),name:row.name.trim(),industry:row.sicDescription.trim(),url:`https://data.sec.gov/submissions/CIK${cik.padStart(10,'0')}.json`,checkedAt:new Date(now).toISOString()};
}
export function usableIssuerProfile(company:ThemedCompany,profile:VerifiedIssuerProfile|undefined,now=Date.now()){
  if(!profile||profile.companyId!==company.id||Number(profile.cik)!==Number(company.cik)||!profile.name?.trim()||!profile.industry?.trim()||!secSourceMatchesIssuer(profile.url,company.cik))return;
  const age=now-Date.parse(profile.checkedAt);return Number.isFinite(age)&&age>=-30_000&&age<=86400_000?profile:undefined;
}

/** Remove redundant roles and use a broad valid stage for the selected closest sector. */
export function closestThemeAssignments(assignments:ThemeAssignment[],catalog:ThemeCatalog){
  const result:ThemeAssignment[]=[];
  for(const input of assignments){
    const sectors=catalogGraphSectors(catalog,input.theme);
    const sector=(id:string)=>sectors.find(row=>row.id===id||row.stages.includes(id)||row.stages.includes(`${input.theme}:${id}`));
    const primary=sector(input.primarySector);assert(primary,'Unknown primary sector');
    const existing=result.find(row=>row.theme===input.theme);
    const primaryId=existing?.primarySector??primary.id;
    const secondary=[...new Set([...(existing?.secondaryRoles??[]),...(existing?[primary.id]:[]),...(input.secondaryRoles??[]).map(id=>{const row=sector(id);assert(row,'Unknown secondary sector');return row.id;})])].filter(id=>id!==primaryId);
    const selected=sectors.filter(row=>row.id===primaryId||secondary.includes(row.id));
    const allowed=[...new Set(selected.flatMap(row=>row.stages).filter(id=>catalog.some(node=>node.id===id)))];
    const stages=[...new Set([...(existing?.aiStageIds??[]),...(input.aiStageIds??[])])].map(id=>allowed.find(node=>node===id||node.split('.').at(-1)===id)).filter((id):id is string=>!!id);
    const broad=allowed.find(id=>id===`ai.${primaryId}`)??allowed.slice().sort((a,b)=>a.split('.').length-b.split('.').length)[0];
    if(input.theme==='ai')assert(stages.length||broad,'Missing catalog AI stage');
    const sources=[...(existing?.sources??[]),...input.sources].map(source=>({...source,url:officialSourceUrl(source.url)}));
    const output={...input,primarySector:primaryId,secondaryRoles:secondary,aiStageIds:input.theme==='ai'?[...new Set(stages.length?stages:[broad!])]:[],sources:sources.filter((source,index)=>sources.findIndex(row=>row.url===source.url)===index).slice(0,5)};
    if(existing)result[result.indexOf(existing)]=output;else result.push(output);
  }
  assert(result.length,'At least one closest existing theme is required');return result;
}
