import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReadFingerprint,reportNativeRead} from '../../src/lib/market-store/native-read-observability';
test('fingerprints distinguish predicate values, projections and cursors',()=>{
 const base=[{method:'where',args:['companyId','==','US:AAPL']}];
 assert.equal(nativeReadFingerprint(base),nativeReadFingerprint(structuredClone(base)));
 for(const steps of [[{method:'where',args:['companyId','==','US:MSFT']}],
   [...base,{method:'select',args:['name']}],[...base,{method:'select',args:['market']}],
   [...base,{method:'startAfter',args:['US:AAPL']}]] as typeof base[])
   assert.notEqual(nativeReadFingerprint(base),nativeReadFingerprint(steps));
 assert.notEqual(nativeReadFingerprint([...base,{method:'select',args:['name']}]),nativeReadFingerprint([...base,{method:'select',args:['market']}]));
});
test('large read logs preserve counts without exposing values and logging failure is harmless',()=>{
 const logs:string[]=[];const original=console.info;
 try {console.info=(s:string)=>{logs.push(s);};
 const steps=[{method:'where',args:['companyId','==','private-value']}];
 reportNativeRead('companies',steps,99,false);assert.equal(logs.length,0);
 reportNativeRead('companies',steps,11728,false);assert.equal(logs.length,1);
 assert.equal(JSON.parse(logs[0]).documentsReturned,11728);assert.ok(!logs[0].includes('private-value'));
 console.info=()=>{throw Error('sink unavailable');};assert.doesNotThrow(()=>reportNativeRead('companies',steps,11728,true));
 } finally {console.info=original;}
});
