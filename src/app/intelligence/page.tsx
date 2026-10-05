import type { Metadata } from 'next';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/i18n/server';
import { loadIntelligenceSnapshot } from '@/lib/intelligence/service';
import { parseCompanyTheme } from '@/lib/company-themes/model';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{return localizedMetadata({title:'Investment Intelligence | YouAnalyst',description:'Explore companies, documented relationships and recorded primary-source evidence.',alternates:{canonical:'/intelligence'}});}
export default async function IntelligencePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  const value=(key:string)=>typeof params[key]==='string'?params[key]:'';
  const theme=parseCompanyTheme(value('theme'));
  const snapshot=await loadIntelligenceSnapshot(new Date(),theme).catch(()=>undefined);
  return <LiveInvestmentIntelligence initialTheme={theme} initialSnapshot={snapshot} initialView={value('view')} initialCompany={value('company')} initialQuery={value('q')} initialEdge={value('relationship')} initialEvent={value('event')}/>;
}
