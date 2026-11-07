import type {IntelligenceSnapshot} from './model';

export type IntelligencePayload=Omit<IntelligenceSnapshot,'graph'>&{graph?:IntelligenceSnapshot['graph']};
/** Presentation-only paging. Complete source facts retain totals for arbitrary filters. */
export function intelligencePayload(snapshot:IntelligenceSnapshot,compact:boolean,omitGraph:boolean):IntelligencePayload {
 const value={...snapshot};
 if(compact&&value.events.length>20){value.events=value.events.slice(0,20);value.eventsLimited=true;}
 if(omitGraph){const payload:IntelligencePayload={...value};delete payload.graph;return payload;}
 return value;
}
