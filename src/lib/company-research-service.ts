import {withCompanyPageReads} from './local-cache/company-page-scope';
import { cache } from "react";
import { getAdminFirestore } from "./firebase/admin";
import {loadCompanyDocuments} from './company-document-cache';
import { companyResearchGraph } from "./knowledge-graph/company-research-projection";
import { buildCompanyResearch } from "./company-research";
import { loadCompanyNeighborhood } from "./knowledge-graph/company-neighborhood";
import { readCompanyLookup } from "./company-lookup-cache";
import {timeCompanyPhase} from './company-page-timing';

// A retry must retain the same company scope as the initial read.
export const loadCompanyPageGraph=cache((id:string)=>withCompanyPageReads(async()=>{
 const db=getAdminFirestore(),[company]=await loadCompanyDocuments(db,'companies',[id]);
 return loadCompanyNeighborhood(db,id,company.data());
}));

export type ResolvedCompany = {id:string; data:Record<string,unknown>|undefined; path:string|null};
const loadTickerRecord=cache(async(ticker:string)=>{
 const db=getAdminFirestore();
 return (await readCompanyLookup(db,db.collection('companies').doc(`US:${ticker}`))).data();
});

// Reuse the route's exact identity. A company page never needs the directory or
// global valuations to determine its name, publication status or direct sources.
export const loadCompanyResearch = cache((ticker:string,resolved?:ResolvedCompany)=>withCompanyPageReads(async()=>{
 const db=getAdminFirestore(), id=`US:${ticker}`;
 const data=resolved?.id===id?resolved.data:await loadTickerRecord(ticker);
 const neighborhood=await timeCompanyPhase('relationships',()=>loadCompanyNeighborhood(db,id,data)).catch(()=>null);
 return {...buildCompanyResearch(ticker,data?[data]:[],neighborhood?companyResearchGraph(neighborhood):null),neighborhood};
}));
