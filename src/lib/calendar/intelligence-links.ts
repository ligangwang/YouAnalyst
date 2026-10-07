import type { Firestore } from 'firebase-admin/firestore';
import { validDate } from '../earnings/model';
import type { IntelligenceEvent } from '../intelligence/model';
import { isCalendarCandidate } from './candidates';
import { eventDay } from './display';
import type { ScheduledEvent } from './model';

/** Follow stored receipts to current schedules, never infer creation from a title. */
export async function attachCalendarLinks(db:Firestore,events:IntelligenceEvent[]):Promise<IntelligenceEvent[]> {
  const sourceIds=[...new Set(events.filter(event=>event.category==='BUSINESS'&&isCalendarCandidate(event.title,event.summary))
    .flatMap(event=>event.evidence.filter(source=>['IR','Exchange'].includes(source.channel)&&/^company_(?:news|disclosure)_/.test(source.id)).map(source=>source.id)))];
  if(!sourceIds.length)return events;
  const collection=db.collection('events');
  const sources=await db.getAll(...sourceIds.map(id=>collection.doc(id)));
  const receiptBySource=new Map(sources.flatMap(source=>{
    const id=source.get('calendarExtraction.receiptId');
    return typeof id==='string'&&id.startsWith('calendar_extraction_')?[[source.id,id] as const]:[];
  }));
  const receiptIds=[...new Set(receiptBySource.values())];
  if(!receiptIds.length)return events;
  const receipts=await db.getAll(...receiptIds.map(id=>collection.doc(id)));
  const schedulesByReceipt=new Map(receipts.filter(receipt=>receipt.get('status')==='complete').map(receipt=>{
    const ids=receipt.get('eventIds');
    return [receipt.id,Array.isArray(ids)?ids.filter((id):id is string=>typeof id==='string'&&id.startsWith('scheduled_event_')):[]] as const;
  }));
  const scheduleIds=[...new Set([...schedulesByReceipt.values()].flat())];
  if(!scheduleIds.length)return events;
  const schedules=await db.getAll(...scheduleIds.map(id=>collection.doc(id)));
  const confirmed=new Map(schedules.filter(doc=>doc.get('type')==='scheduled_event'&&['official','extracted'].includes(doc.get('confirmation')))
    .map(doc=>[doc.id,{...doc.data(),id:doc.id} as ScheduledEvent]));
  return events.map(event=>{
    const links=event.evidence.flatMap(source=>(schedulesByReceipt.get(receiptBySource.get(source.id)??'')??[]).flatMap(id=>{
      const schedule=confirmed.get(id);
      if(!schedule||!event.companyIds.includes(schedule.companyId)||!schedule.sourceEventIds?.includes(source.id)||!validDate(schedule.scheduled_date))return [];
      return [{id,companyId:schedule.companyId,day:eventDay(schedule),validationWarning:Boolean(schedule.validationWarnings?.length)}];
    }));
    return links.length?{...event,calendarEvents:[...new Map(links.map(link=>[link.id,link])).values()]}:event;
  });
}
