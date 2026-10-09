import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { loadCollectionUniverse, loadCollectionCompanies } from '../company-themes/service';
import { activeThemeIds } from '../company-themes/model';
import { companySector } from '../knowledge-graph/sectors';
import { validDate } from '../earnings/model';
import { reviewedCompanyNames } from '../market-companies/reviewed-names';
import type { CalendarItem, CalendarPayload, ScheduledEvent } from './model';

export function calendarRange(from: string | null, to: string | null) {
  if (!validDate(from) || !validDate(to) || from! > to! || Date.parse(to!) - Date.parse(from!) > 62*86400000) throw new Error('Choose a valid date range of at most 63 days.');
  return {from:from!,to:to!};
}

/** Range by scheduled date, never by announcement date or a recent-feed limit. */
export async function loadCalendar(from: string, to: string, db: Firestore = getAdminFirestore()): Promise<CalendarPayload> {
  // Include one source-local day either side for events converted to Eastern time.
  const shift = (day:string,delta:number)=>new Date(Date.parse(day)+delta*86400000).toISOString().slice(0,10);
  const query = db.collection('events').where('type','==','scheduled_event')
    .where('scheduled_date','>=',shift(from,-1)).where('scheduled_date','<=',shift(to,1)).orderBy('scheduled_date');
  const [snapshot,count,universe,companies,collector] = await Promise.all([
    query.limit(1000).get(),query.count().get(),loadCollectionUniverse(db),loadCollectionCompanies(db),db.collection('collectors').doc('earnings-calendar').get(),
  ]);
  const nodes = new Map(universe.nodes.filter(node=>node.kind==='COMPANY').map(node=>[node.id,node]));
  const records = new Map(companies.map(doc=>[doc.id,doc.data()]));
  const events: CalendarItem[] = snapshot.docs.flatMap(doc=>{
    const event = {...doc.data(),id:doc.id} as ScheduledEvent;
    const node = nodes.get(event.companyId);
    if(!node || !['official','extracted'].includes(event.confirmation))return [];
    const record=records.get(node.id);
    const themes=activeThemeIds({themeMemberships:record?.themeMemberships});
    if(!record?.themeMemberships?.ai && !themes.includes('ai') && node.stageIds?.some(stage=>!stage.includes(':')))themes.push('ai');
    return [{...event,companyName:node.name??node.symbol??node.id,companyNames:reviewedCompanyNames(node.id,node.name??'',node.names),ticker:node.symbol||node.id.split(':')[1],themes,sector:companySector(node)}];
  });
  return {events,total:count.data().count,truncated:count.data().count>snapshot.size,from,to,
    lastCollectedAt:collector.get('lastRunAt')??null,collectionStatus:collector.get('status')??'not_started'};
}
