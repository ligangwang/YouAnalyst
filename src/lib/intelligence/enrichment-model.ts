import type {IntelligenceCalendarEvent,IntelligenceSnapshot} from './model';
import type {GraphNode} from '../knowledge-graph/model';
import {groupCompanyAnnouncements} from './announcement-grouping';
export type IntelligenceEnrichment={
  snapshotAt?:string;
  calendar?:Record<string,IntelligenceCalendarEvent[]>;
  prices?:Record<string,GraphNode['dailyPrice']|null>;
  eventReturns?:IntelligenceSnapshot['eventReturns'];
};
/** Source totals remain authoritative while only confirmed rows are regrouped. */
export function enrichIntelligenceSnapshot(base:IntelligenceSnapshot,patch:IntelligenceEnrichment):IntelligenceSnapshot{
  if(patch.snapshotAt!==base.generatedAt)return base;
  const events=base.events.map(event=>Object.hasOwn(patch.calendar??{},event.id)?{...event,calendarPending:false,calendarEvents:patch.calendar![event.id]}:event);
  const grouped=groupCompanyAnnouncements(events),returns={...base.eventReturns,...patch.eventReturns},byId=new Map(events.map(event=>[event.id,event]));
  for(const event of grouped){
    const preferred=[event.id,...(event.relatedEventIds??[])].map(id=>byId.get(id)).find(source=>source&&source.published_at===event.published_at&&source.publication_date===event.publication_date);
    if(preferred&&returns[preferred.id])returns[event.id]=returns[preferred.id];
  }
  return {...base,events:grouped,eventReturns:returns,
    graph:patch.prices?{...base.graph,nodes:base.graph.nodes.map(node=>Object.hasOwn(patch.prices!,node.id)?{...node,dailyPrice:patch.prices![node.id]??undefined}:node)}:base.graph};
}
