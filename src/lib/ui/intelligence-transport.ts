import type {IntelligenceSnapshot} from '../intelligence/model';
import {compactGraph,expandGraph,type GraphTransport} from './graph-transport';

export type PresentationIntelligenceSnapshot=IntelligenceSnapshot&{eventsLimited?:boolean};
export type EncodedIntelligenceSnapshot=Omit<PresentationIntelligenceSnapshot,'graph'>&{graph:GraphTransport};
export type IntelligencePayload=Omit<PresentationIntelligenceSnapshot,'graph'>&{graph?:GraphTransport};
export function encodeIntelligenceSnapshot(snapshot:PresentationIntelligenceSnapshot,serverProps=false):EncodedIntelligenceSnapshot {
 const graph=compactGraph(snapshot.graph);
 // A text block avoids making React Flight serialize every dictionary cell.
 return {...snapshot,graph:serverProps?{encoding:'columns-json-v1',data:JSON.stringify(graph)}:graph};
}
export function decodeIntelligenceSnapshot(snapshot:EncodedIntelligenceSnapshot):PresentationIntelligenceSnapshot {
 return {...snapshot,graph:expandGraph(snapshot.graph)};
}
export function compactIntelligenceSnapshot(snapshot:IntelligenceSnapshot):PresentationIntelligenceSnapshot {
 return snapshot.events.length>20?{...snapshot,events:snapshot.events.slice(0,20),eventsLimited:true}:snapshot;
}
/** Presentation-only paging. Complete source facts retain totals for arbitrary filters. */
export function intelligencePayload(snapshot:IntelligenceSnapshot,compact:boolean,omitGraph:boolean,encodeGraph=false):IntelligencePayload {
 const value=compact?compactIntelligenceSnapshot(snapshot):snapshot;
 if(omitGraph){const payload:IntelligencePayload={...value};delete payload.graph;return payload;}
 return encodeGraph?encodeIntelligenceSnapshot(value):value;
}
