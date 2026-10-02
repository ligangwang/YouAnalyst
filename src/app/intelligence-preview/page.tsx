import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InvestmentIntelligence } from '@/components/investment-intelligence';
export const metadata:Metadata={title:'Investment Intelligence · Local Preview | YouAnalyst',robots:{index:false,follow:false}};
export default function PreviewPage(){if(process.env.NODE_ENV!=='development')notFound();return <InvestmentIntelligence/>;}
