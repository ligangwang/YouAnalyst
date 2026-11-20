import type {IntelligenceSnapshot} from './model';
import type {GraphNode} from '../knowledge-graph/model';
export type IntelligenceEnrichment={
  snapshotAt?:string;
  prices?:Record<string,GraphNode['dailyPrice']|null>;
  eventReturns?:IntelligenceSnapshot['eventReturns'];
};
export function enrichIntelligenceSnapshot(base:IntelligenceSnapshot,patch:IntelligenceEnrichment):IntelligenceSnapshot{
  if(patch.snapshotAt!==base.generatedAt)return base;
  return {...base,eventReturns:{...base.eventReturns,...patch.eventReturns},
    graph:patch.prices?{...base.graph,nodes:base.graph.nodes.map(node=>Object.hasOwn(patch.prices!,node.id)?{...node,dailyPrice:patch.prices![node.id]??undefined}:node)}:base.graph};
}
