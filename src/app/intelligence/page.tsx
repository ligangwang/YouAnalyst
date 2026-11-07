import {encodeIntelligenceSnapshot} from '@/lib/ui/intelligence-transport';
import {PreloadGraphChunks as PreloadCompanyGraph} from '@/components/company-graph-preload';
import {parseIndustryView} from '@/lib/knowledge-graph/views';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntelligenceLoadingShell } from '@/components/intelligence-loading-shell';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/ui/i18n/server';
import { loadIntelligenceUniverse } from '@/lib/intelligence/service';
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
  // The graph must not wait for feed/news discovery or include its document index
  // in the HTML. The client loads that feed independently, reusing this graph.
  // A cold read retains its targeted scope after the HTML budget expires.
  const snapshot=catalog?await initialSnapshotWithinBudget(withCompanyPageReads(async()=>encodeIntelligenceSnapshot(await loadIntelligenceUniverse(new Date(),theme),true))):undefined;
  return <LiveInvestmentIntelligence initialTheme={theme} initialSnapshot={snapshot} initialView={value('view')} initialCompany={value('company')} initialQuery={value('q')} initialEdge={value('relationship')} initialEvent={value('event')}/>;
}
