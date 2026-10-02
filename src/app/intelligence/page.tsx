import type { Metadata } from 'next';
import { LiveInvestmentIntelligence } from '@/components/live-investment-intelligence';
import { localizedMetadata } from '@/lib/i18n/server';
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{return localizedMetadata({title:'Investment Intelligence | YouAnalyst',description:'Explore companies, documented relationships and recorded primary-source evidence.',alternates:{canonical:'/intelligence'}});}
export default function IntelligencePage(){return <LiveInvestmentIntelligence/>;}
