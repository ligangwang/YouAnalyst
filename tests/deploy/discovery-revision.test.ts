import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDiscoveryRevision as verify} from '../../scripts/verify-discovery-revision.mjs';
const env={GIT_SHA:'a'.repeat(40),DISCOVERY_RELEASE_REVISION:'service-r123',DISCOVERY_RELEASE_IMAGE:'image@sha256:abc',DISCOVERY_RELEASE_ACCOUNT:'worker@example.com',DISCOVERY_RELEASE_BUNDLE:'serve-sec-discovery'};
const candidate=()=>({metadata:{name:env.DISCOVERY_RELEASE_REVISION},spec:{serviceAccountName:env.DISCOVERY_RELEASE_ACCOUNT,containers:[{image:env.DISCOVERY_RELEASE_IMAGE,command:['node'],args:['dist/serve-sec-discovery.cjs'],env:[{name:'GIT_SHA',value:env.GIT_SHA}]}]},status:{conditions:[{type:'Ready',status:'True'}]}});
test('candidate validates immutable revision identity and readiness',()=>{
 verify(candidate(),'revision',env);
 for(const mutate of [(v:any)=>v.metadata.name='old',(v:any)=>v.spec.containers[0].env[0].value='old',(v:any)=>v.spec.containers[0].image='wrong',(v:any)=>v.status.conditions[0].status='False',(v:any)=>v.spec.serviceAccountName='wrong']){
  const value=candidate();mutate(value);assert.throws(()=>verify(value,'revision',env));
 }
});
test('serving route must match the validated revision regardless of template or latestReady',()=>{
 const value={status:{latestReadyRevisionName:env.DISCOVERY_RELEASE_REVISION,traffic:[{revisionName:'old',percent:100}]}};
 assert.throws(()=>verify(value,'traffic',env));
 value.status.traffic[0].revisionName=env.DISCOVERY_RELEASE_REVISION;verify(value,'traffic',env);
 value.status.traffic[0].percent=99;assert.throws(()=>verify(value,'traffic',env));
});
