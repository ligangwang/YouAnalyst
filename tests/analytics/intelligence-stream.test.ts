import assert from 'node:assert/strict';
import test from 'node:test';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import {resolveInitialIntelligenceFeed} from '../../src/lib/ui/intelligence-transport';
const require=createRequire(import.meta.url);
const {createFromNodeStream}=require('next/dist/compiled/react-server-dom-webpack/client.node');

async function flightFeed(){
 const stream=new PassThrough();
 const root=createFromNodeStream(stream,{moduleMap:{},serverModuleMap:{},moduleLoading:null});
 // Decode a real Flight promise reference, not a native Promise stand-in.
 stream.write('0:{"feed":"$@1"}\n');
 const model=await root as {feed:PromiseLike<string|undefined>};
 return {stream,feed:model.feed};
}

test('streamed feed survives the installed React Flight serialization boundary',async()=>{
 const {stream,feed}=await flightFeed();
 assert.equal(feed.then(()=>{}),undefined,'the installed Flight thenable does not chain');
 const result=resolveInitialIntelligenceFeed(feed);
 stream.end('1:"real streamed feed"\n');
 assert.equal(await result,'real streamed feed');
});

test('interrupted Flight feed resolves to the API fallback without an unhandled rejection',async()=>{
 const {stream,feed}=await flightFeed();
 const result=resolveInitialIntelligenceFeed(feed);
 stream.destroy(new Error('Stream interrupted'));
 assert.equal(await result,undefined);
});
