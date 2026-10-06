import type { Metadata } from 'next';
import { localizedMetadata } from '@/lib/i18n/server';
import { EarningsCalendar } from '@/components/earnings-calendar';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({title:'Earnings Calendar: AI, Robotics & Space Stocks | YouAnalyst',
    description:'Company-announced earnings releases and calls for AI, Robotics and Space companies. Confirmed dates, time zones and original sources.',alternates:{canonical:'/calendar'}});
}
export default function CalendarPage() {return <EarningsCalendar />;}
