import type {KnowledgeGraph} from '../knowledge-graph/model';

// Column dictionaries deduplicate repeated theme metadata, labels and evidence
// references without removing any graph facts. This is a wire format only.
type Table = {keys:string[]; values:unknown[][]; rows:number[][]};
export type CompactGraph = {encoding:'columns-v1'; asOf:string; nodes:Table; relationships:Table; sources:Table};
export type GraphTransport = KnowledgeGraph | CompactGraph;

function packTable(records:object[]):Table {
  const keys=[...new Set(records.flatMap(Object.keys))];
  const values:unknown[][]=keys.map(()=>[]);
  const dictionaries=keys.map(()=>new Map<string,number>());
  const rows=records.map(record=>keys.map((key,column)=>{
    const value=(record as Record<string,unknown>)[key];
    if(value===undefined)return -1;
    const serialized=JSON.stringify(value);
    let index=dictionaries[column].get(serialized);
    if(index===undefined){
      index=values[column].length;dictionaries[column].set(serialized,index);
      values[column].push(value);
    }
    return index;
  }));
  return {keys,values,rows};
}

function unpackTable(table:Table):object[] {
  if(!Array.isArray(table.keys)||!Array.isArray(table.values)||!Array.isArray(table.rows)||table.keys.length!==table.values.length||new Set(table.keys).size!==table.keys.length)throw Error('Invalid compact graph');
  return table.rows.map(row=>{
    if(!Array.isArray(row)||row.length!==table.keys.length)throw Error('Invalid compact graph row');
    return Object.fromEntries(row.flatMap((index,column)=>{
      if(index===-1)return [];
      if(!Number.isInteger(index)||index<0||!Array.isArray(table.values[column])||index>=table.values[column].length)throw Error('Invalid compact graph reference');
      return [[table.keys[column],table.values[column][index]]];
    }));
  });
}

export function compactGraph(graph:KnowledgeGraph):CompactGraph {
  return {encoding:'columns-v1',asOf:graph.asOf,nodes:packTable(graph.nodes),relationships:packTable(graph.relationships),sources:packTable(graph.sources)};
}

export function expandGraph(graph:GraphTransport):KnowledgeGraph {
  if(!('encoding' in graph))return graph;
  if(graph.encoding!=='columns-v1')throw Error('Unsupported graph encoding');
  return {asOf:graph.asOf,nodes:unpackTable(graph.nodes),relationships:unpackTable(graph.relationships),sources:unpackTable(graph.sources)} as KnowledgeGraph;
}
