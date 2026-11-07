import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compactGraph,expandGraph} from '../../src/lib/ui/graph-transport';
import {encodeIntelligenceSnapshot,decodeIntelligenceSnapshot,intelligencePayload} from '../../src/lib/ui/intelligence-transport';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';

const graph:KnowledgeGraph={asOf:'2026-11-07',nodes:[
 {id:'US:A',kind:'COMPANY',order:0,name:'Company A',summary:'Full business description',names:{'zh-CN':'公司甲'},stageIds:['compute'],sourceIds:['source:a']},
 {id:'US:B',kind:'COMPANY',order:1,name:'Company B',stageIds:[],aliases:[],marketCap:{value:123,currency:'USD',priceDate:'2026-11-06'}}
],relationships:[{id:'A-B',source:'US:A',target:'US:B',type:'SUPPLIES',summary:'Complete relationship description',commercialStatus:'confirmed',sourceIds:['source:a'],facts:[{state:'confirmed',scope:'supply',sourceIds:['source:a'],limitation:'Evidence limitation'}],communityCredits:[{name:'Researcher',points:0}]}],sources:[{id:'source:a',url:'https://example.com/evidence',title:'Original evidence',titleZh:'原始证据',sourceDate:null}]};

test('graph transport round-trips descriptions, evidence, optional fields and zero values',()=>{
 const expected=structuredClone(graph);
 const packed=compactGraph(graph);
 assert.equal(packed.encoding,'columns-v1');
 assert.deepEqual(expandGraph(JSON.parse(JSON.stringify(packed))),expected);
 assert.deepEqual(graph,expected,'packing does not mutate the service snapshot');
 assert.equal(expandGraph(graph),graph,'legacy graph remains compatible');
 assert.deepEqual(expandGraph(compactGraph({asOf:'',nodes:[],relationships:[],sources:[]})),{asOf:'',nodes:[],relationships:[],sources:[]});
});

test('column dictionaries remove repeated metadata and reduce decoded bytes',()=>{
 const fixture={...graph,nodes:Array.from({length:300},(_,i)=>({...graph.nodes[0],id:`US:COMPANY${i}`,order:i,themeNames:{en:'Artificial intelligence','zh-CN':'人工智能'},summary:`Company ${i} business description`}))};
 const raw=JSON.stringify(fixture),packed=JSON.stringify(compactGraph(fixture));
 assert.ok(packed.length<raw.length*.65);
 assert.deepEqual(expandGraph(JSON.parse(packed)),fixture);
});

test('encoded snapshots keep graph versions and complete feed facts; API encoding is opt in',()=>{
 const snapshot={graph,graphVersion:'original-version',events:[],sourceDocuments:[],eventsLimited:true} as unknown as IntelligenceSnapshot;
 const encoded=encodeIntelligenceSnapshot(snapshot);
 assert.deepEqual(decodeIntelligenceSnapshot(encoded),snapshot);
 assert.equal(intelligencePayload(snapshot,false,false).graph,graph);
 const compact=intelligencePayload(snapshot,false,false,true);
 assert.equal(compact.graph&&'encoding' in compact.graph,true);
 assert.equal(intelligencePayload(snapshot,false,true,true).graph,undefined);
});

test('invalid dictionary references and unsupported encodings are rejected',()=>{
 const packed=compactGraph(graph);
 packed.nodes.rows[0][0]=999999;
 assert.throws(()=>expandGraph(packed),/reference/);
 const unsupported={...compactGraph(graph),encoding:'future'};
 assert.throws(()=>expandGraph(unsupported as never),/Unsupported/);
});
