import type {IntelligenceSnapshot} from '../intelligence/model';

export type PresentationIntelligenceSnapshot=IntelligenceSnapshot&{eventsLimited?:boolean};
export type IntelligencePayload=Omit<PresentationIntelligenceSnapshot,'graph'>&{graph?:IntelligenceSnapshot['graph']};
export function compactIntelligenceSnapshot(snapshot:IntelligenceSnapshot):PresentationIntelligenceSnapshot {
 return snapshot.events.length>20?{...snapshot,events:snapshot.events.slice(0,20),eventsLimited:true}:snapshot;
}
/** Presentation-only paging. Complete source facts retain totals for arbitrary filters. */
export function intelligencePayload(snapshot:IntelligenceSnapshot,compact:boolean,omitGraph:boolean):IntelligencePayload {
 const value=compact?compactIntelligenceSnapshot(snapshot):snapshot;
 if(omitGraph){const payload:IntelligencePayload={...value};delete payload.graph;return payload;}
 return value;
}
