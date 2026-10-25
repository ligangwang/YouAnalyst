import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntelligenceLoadingShell } from '@/components/intelligence-loading-shell';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/ui/i18n/server';
import { loadIntelligenceSnapshot } from '@/lib/intelligence/service';
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
  return <Suspense fallback={<IntelligenceLoadingShell theme={theme}/>}><InitialWorkspace theme={theme} value={value}/></Suspense>;
}

async function InitialWorkspace({theme,value}:{theme:string;value:(key:string)=>string}){
  const catalog=await initialSnapshotWithinBudget(loadThemeCatalog());
  const resolved=catalog?resolveCatalogTheme(catalog,value('theme')):theme;
  if(!resolved)return <IntelligenceLoadingShell error="Investment theme unavailable"/>;
  theme=resolved;
  // The shared read may outlive the HTML budget; retain its targeted scope
  // while it warms the same complete snapshot used by the browser API.
  const snapshot=catalog?await initialSnapshotWithinBudget(withCompanyPageReads(()=>loadIntelligenceSnapshot(new Date(),theme))):undefined;
  return <LiveInvestmentIntelligence initialTheme={theme} initialSnapshot={snapshot} initialView={value('view')} initialCompany={value('company')} initialQuery={value('q')} initialEdge={value('relationship')} initialEvent={value('event')}/>;
}
