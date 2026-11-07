import assert from 'node:assert/strict';
import {test} from 'node:test';
import {intelligencePayload} from '../../src/lib/ui/intelligence-transport';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';

test('compact feed retains complete totals and graph identity while paging detailed events',()=>{
 const events=Array.from({length:100},(_,i)=>({id:String(i),summary:'evidence '.repeat(1000)}));
 const sourceDocuments=Array.from({length:100},(_,i)=>({id:String(i)}));
 const snapshot={events,sourceDocuments,statisticsComplete:true,graphVersion:'v1',graph:{nodes:[{id:'US:AAPL'}]},feedWindow:{hasMore:true}} as unknown as IntelligenceSnapshot;
 const first=intelligencePayload(snapshot,true,true);
 assert.equal(first.events.length,20);assert.equal(first.eventsLimited,true);assert.equal(first.graph,undefined);
 assert.equal(first.graphVersion,'v1');assert.equal(first.sourceDocuments,sourceDocuments);assert.equal(first.statisticsComplete,true);
 assert.equal(snapshot.events.length,100);assert.ok(snapshot.graph);
 const all=intelligencePayload(snapshot,false,true);assert.equal(all.events.length,100);assert.equal(all.eventsLimited,undefined);
 const legacy=intelligencePayload(snapshot,false,false);assert.equal(legacy.graph,snapshot.graph);assert.equal(legacy.events.length,100);
 assert.ok(JSON.stringify(first).length<JSON.stringify(snapshot).length/4);
});
