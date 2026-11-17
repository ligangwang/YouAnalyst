import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp,type DocumentSnapshot} from 'firebase-admin/firestore';
import {nativeReadFingerprint,reportNativeRead,nativeDocumentEvidence,reportNativeBatchRead} from '../../src/lib/market-store/native-read-observability';

const document=(id:string,seconds:number|null=1,exists=true)=>({
 ref:{path:`companies/${id}`},exists,updateTime:seconds===null?undefined:new Timestamp(seconds,0),
 data:()=>{throw Error('Diagnostics must not read payloads');},
}) as unknown as DocumentSnapshot;

test('version evidence separates changed versions, changed identities and missing documents',()=>{
 const a=document('private-a'),b=document('private-b');
 const evidence=nativeDocumentEvidence([a,b]);
 assert.deepEqual(evidence,nativeDocumentEvidence([b,a]));
 const changed=nativeDocumentEvidence([a,document('private-b',2)]);
 assert.equal(changed.documentSetFingerprint,evidence.documentSetFingerprint);
 assert.notEqual(changed.documentVersionsFingerprint,evidence.documentVersionsFingerprint);
 assert.notEqual(nativeDocumentEvidence([a]).documentSetFingerprint,evidence.documentSetFingerprint);
 assert.notEqual(nativeDocumentEvidence([a,document('private-b',null,false)]).documentVersionsFingerprint,evidence.documentVersionsFingerprint);
 assert.equal(nativeDocumentEvidence([document('unknown',null)]).versionEvidenceComplete,false);
 assert.equal(nativeDocumentEvidence([document('missing',null,false)]).versionEvidenceComplete,true);
 assert.ok(!JSON.stringify(evidence).includes('private'));
});

test('batch observations retain missing-read counts and projection identity without payloads',()=>{
 const logs:string[]=[];const original=console.info;
 const docs=Array.from({length:25},(_,i)=>document(`private-${i}`,i===0?null:1,i!==0));
 try {console.info=(value:string)=>{logs.push(value);};
 reportNativeBatchRead(docs.slice(1),false);assert.equal(logs.length,0);
 reportNativeBatchRead(docs,false,['name']);reportNativeBatchRead(docs,false,['status']);
 const first=JSON.parse(logs[0]),second=JSON.parse(logs[1]);
 assert.equal(first.documentsRequested,25);assert.equal(first.documentsReturned,24);assert.equal(first.documentsMissing,1);
 assert.deepEqual(first.documentsByCollection,{companies:25});assert.equal(first.versionEvidenceComplete,true);
 assert.equal(first.documentSetFingerprint,second.documentSetFingerprint);
 assert.notEqual(first.projectionFingerprint,second.projectionFingerprint);
 assert.ok(!logs.join('').includes('private-'));
 console.info=()=>{throw Error('sink unavailable');};assert.doesNotThrow(()=>reportNativeBatchRead(docs,true));
 }finally{console.info=original;}
});
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
