import test from 'node:test';
import assert from 'node:assert/strict';
import {promoteRelease} from '../../scripts/promote-release.mjs';

function fixture(fail:'none'|'candidate'|'retired'|'logs'|'public'='none') {
  const calls:string[][]=[];let tagged=false,changed=false;
  const command=(args:string[])=>{
    calls.push(args);
    if(args[0]==='logging')return JSON.stringify(fail==='logs'?[{httpRequest:{status:500}}]:[]);
    if(args[1]==='revisions')return JSON.stringify({status:{conditions:[{type:'Active',status:fail==='retired'?'False':'True'}]}});
    if(args[2]==='update-traffic'){
      if(args.includes('--update-tags'))tagged=true;
      if(args.includes('--to-revisions'))changed=true;
      return '';
    }
    return JSON.stringify({status:{url:'https://public.invalid',traffic:[{revisionName:'old',percent:100},
      {revisionName:'new',tag:'candidate',url:'https://new.invalid'},
      ...(tagged?[{revisionName:'old',tag:'retain-old',url:'https://old.invalid'}]:[])]}});
  };
  const request:typeof fetch=async(input)=>{
    const url=String(input);
    if(fail==='public'&&changed&&url.includes('public'))return new Response('',{status:500});
    const revision=url.includes('old')?'old':'new';
    return Response.json({status:'ok',revision,commitSha:fail==='candidate'?'wrong':'abc'});
  };
  return {calls,options:{service:'web',project:'project',region:'region',revision:'new',commit:'abc',
    command,request,sleep:async()=>{},samples:3,interval:0,log:()=>{}}};
}
test('promotion retains and validates predecessor before moving traffic, observes full promotion, never removes retention',async()=>{
  const f=fixture();await promoteRelease(f.options);
  const updates=f.calls.filter(args=>args[2]==='update-traffic');
  assert.deepEqual(updates.map(args=>args.at(-2)),['retain-old=old','new=100']);
  assert.equal(f.calls.filter(args=>args[0]==='logging').length,1);
  assert.equal(f.calls.filter(args=>args[1]==='revisions').length,4);
  assert(!f.calls.some(args=>args.includes('--remove-tags')||args.includes('--to-latest')));
});
test('wrong candidate and inactive predecessor block public traffic changes',async()=>{
  for(const failure of ['candidate','retired'] as const){
    const f=fixture(failure);await assert.rejects(promoteRelease(f.options));
    assert(!f.calls.some(args=>args.includes('--to-revisions')));
  }
});
test('public health or request-log errors stop advancement and restore predecessor',async()=>{
  for(const failure of ['public','logs'] as const){
    const f=fixture(failure);await assert.rejects(promoteRelease(f.options));
    const allocations=f.calls.filter(args=>args.includes('--to-revisions')).map(args=>args.at(-2));
    assert.deepEqual(allocations,['new=100','old=100']);
  }
});
test('log-read failure also restores predecessor instead of silently continuing',async()=>{
  const f=fixture(),command=f.options.command;
  f.options.command=(args:string[])=>{if(args[0]==='logging')throw Error('Permission denied');return command(args);};
  await assert.rejects(promoteRelease(f.options),/Permission denied/);
  assert.equal(f.calls.filter(args=>args.includes('--to-revisions')).at(-1)?.at(-2),'old=100');
});

test('transient tagged 404 after traffic update recovers without rollback',async()=>{
 const f=fixture(),request=f.options.request;let failures=0;
 f.options.request=async(input,options)=>{
  if(String(input).includes('new.invalid')&&f.calls.some(a=>a.includes('--to-revisions'))&&failures++<2)return new Response('',{status:404});
  return request(input,options);
 };
 await promoteRelease(f.options);
 assert.deepEqual(f.calls.filter(a=>a.includes('--to-revisions')).map(a=>a.at(-2)),['new=100']);
});
test('persistent tagged 404 after traffic update rolls back',async()=>{
 const f=fixture(),request=f.options.request;
 f.options.request=async(input,options)=>String(input).includes('new.invalid')&&f.calls.some(a=>a.includes('--to-revisions'))?new Response('',{status:404}):request(input,options);
 await assert.rejects(promoteRelease(f.options),/Tagged health.*404/);
 assert.equal(f.calls.filter(a=>a.includes('--to-revisions')).at(-1)?.at(-2),'old=100');
});
test('public 404 is never retried during tagged routing recovery',async()=>{
 const f=fixture(),request=f.options.request;let publicFailures=0;
 f.options.request=async(input,options)=>{
  if(f.calls.some(a=>a.includes('--to-revisions'))){
   if(String(input).includes('new.invalid'))return new Response('',{status:404});
   if(String(input).includes('public.invalid')){publicFailures++;return new Response('',{status:404});}
  }
  return request(input,options);
 };
 await assert.rejects(promoteRelease(f.options),/Public health.*404/);
 assert.equal(publicFailures,1);
 assert.equal(f.calls.filter(a=>a.includes('--to-revisions')).at(-1)?.at(-2),'old=100');
});
test('public endpoint must converge to candidate before success',async()=>{
 const f=fixture(),request=f.options.request;
 f.options.request=async(input,options)=>String(input).includes('public.invalid')?Response.json({status:'ok',revision:'old'}):request(input,options);
 await assert.rejects(promoteRelease(f.options),/did not converge/);
 assert.equal(f.calls.filter(a=>a.includes('--to-revisions')).at(-1)?.at(-2),'old=100');
});
