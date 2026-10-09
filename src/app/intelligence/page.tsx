import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IntelligenceLoadingShell } from '@/components/intelligence-loading-shell';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/i18n/server';
import { loadIntelligenceSnapshot } from '@/lib/intelligence/service';
import { parseCompanyTheme } from '@/lib/company-themes/model';
import { UiText } from '@/components/ui-text';
import { LocalizedLink } from '@/components/localized-link';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{return localizedMetadata({title:'Investment Intelligence | YouAnalyst',description:'Explore companies, documented relationships and recorded primary-source evidence.',alternates:{canonical:'/intelligence'}});}
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==='string'?params[key]:'';
  const theme=parseCompanyTheme(value('theme'));
  return <><section aria-labelledby="explore-introduction" className="mx-auto max-w-screen-2xl px-4 py-3 text-sm text-slate-300"><h2 id="explore-introduction" className="font-semibold text-cyan-100"><UiText text="Explore companies and their connections"/></h2><p><UiText text="Compare technology companies, inspect suppliers and partners, and follow developments backed by original sources."/></p><LocalizedLink href="/?company=US%3ANVDA" className="text-cyan-200 underline"><UiText text="Start with NVIDIA’s suppliers and partners"/></LocalizedLink></section><Suspense fallback={<IntelligenceLoadingShell theme={theme}/>}><InitialWorkspace theme={theme} value={value}/></Suspense></>;
}

async function InitialWorkspace({theme,value}:{theme:ReturnType<typeof parseCompanyTheme>;value:(key:string)=>string}){
  const snapshot=await initialSnapshotWithinBudget(loadIntelligenceSnapshot(new Date(),theme));
  return <LiveInvestmentIntelligence initialTheme={theme} initialSnapshot={snapshot} initialView={value('view')} initialCompany={value('company')} initialQuery={value('q')} initialEdge={value('relationship')} initialEvent={value('event')}/>;
}
