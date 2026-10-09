import type { Metadata } from 'next';
import { localizedMetadata } from '@/lib/i18n/server';
import { EarningsCalendar } from '@/components/earnings-calendar';
import { validDate } from '@/lib/earnings/model';
import { loadCalendar } from '@/lib/calendar/service';
import { easternDay, visibleDays } from '@/lib/calendar/display';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({title:'Earnings Calendar: AI, Robotics & Space Stocks | YouAnalyst',
    description:'Company-announced earnings releases and calls for AI, Robotics and Space companies. Confirmed dates, time zones and original sources.',alternates:{canonical:'/calendar'}});
}
export default async function CalendarPage({searchParams}:{searchParams:Promise<{date?:string|string[];company?:string|string[];event?:string|string[]}>}) {
  const params=await searchParams;
  const today=easternDay(new Date().toISOString());
  const date=typeof params.date==='string'&&validDate(params.date)?params.date:today;
  const days=visibleDays(date,'month');
  const payload=await initialSnapshotWithinBudget(loadCalendar(days[0],days.at(-1)!));
  return <EarningsCalendar key={JSON.stringify(params)} initialToday={today} initialPayload={payload} initialDate={date}
    initialCompany={typeof params.company==='string'?params.company:''} initialEvent={typeof params.event==='string'?params.event:''}/>;
}
