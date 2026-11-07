import {encodeIntelligenceSnapshot,intelligencePayload} from '@/lib/ui/intelligence-transport';
import {PreloadGraphChunks as PreloadCompanyGraph} from '@/components/company-graph-preload';
import {parseIndustryView} from '@/lib/knowledge-graph/views';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntelligenceLoadingShell } from '@/components/intelligence-loading-shell';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/ui/i18n/server';
import { loadIntelligenceUniverse,loadIntelligenceSnapshot } from '@/lib/intelligence/service';
import {parseCompanyTheme} from '@/lib/company-themes/model';
import {loadThemeCatalog} from '@/lib/company-themes/catalog';
import {resolveCatalogTheme} from '@/lib/company-themes/catalog-model';
import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{return localizedMetadata({title:'Investment Intelligence | YouAnalyst',description:'Explore companies, documented relationships and recorded primary-source evidence.',alternates:{canonical:'/intelligence'}});}
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==='string'?params[key]:'';
  const theme=parseCompanyTheme(value('theme'));
  return <><PreloadCompanyGraph enabled={(parseIndustryView(value('view'))??'graph')==='graph'}/><Suspense fallback={<IntelligenceLoadingShell theme={theme}/>}><InitialWorkspace theme={theme} value={value}/></Suspense></>;
}

async function InitialWorkspace({theme,value}:{theme:string;value:(key:string)=>string}){
  const catalog=await initialSnapshotWithinBudget(loadThemeCatalog());
  const resolved=catalog?resolveCatalogTheme(catalog,value('theme')):theme;
  if(!resolved)return <IntelligenceLoadingShell error="Investment theme unavailable"/>;
  theme=resolved;
  // Prepare the graph before starting feed work, so discovery cannot compete
  // with the critical graph read/encoding. Start the same-instance feed before
  // returning the workspace, rather than waiting for a browser API round trip.
  const scoped=['company','feedCompany','q','region','relationship','event'].some(key=>value(key));
  const now=new Date();
  const snapshot=catalog?await initialSnapshotWithinBudget(withCompanyPageReads(async()=>encodeIntelligenceSnapshot(await loadIntelligenceUniverse(now,theme),true))):undefined;
  const feed=snapshot&&!scoped?initialSnapshotWithinBudget(withCompanyPageReads(async()=>JSON.stringify(intelligencePayload(await loadIntelligenceSnapshot(now,theme,undefined,undefined,true),true,true))),10_000):undefined;
  return <LiveInvestmentIntelligence initialTheme={theme} initialSnapshot={snapshot} initialFeed={feed} initialView={value('view')} initialCompany={value('company')} initialQuery={value('q')} initialEdge={value('relationship')} initialEvent={value('event')}/>;
}
