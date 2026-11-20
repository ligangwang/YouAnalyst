import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifiedReleaseProbe} from '../../src/lib/access/release-probe';
import {releaseProbeHeaders} from '../../scripts/release-probe.mjs';

test('release credentials are signed, origin-bound, read-only and short-lived',()=>{
  const previous=process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN='test-service-secret';
  try {
    const origin='https://candidate.example';
    const headers=new Headers(releaseProbeHeaders(origin));
    const req={method:'GET',headers,nextUrl:new URL(origin+'/api/intelligence')};
    assert(verifiedReleaseProbe(req));
    assert(!headers.get('x-ya-release-probe')!.includes('test-service-secret'));
    assert(!verifiedReleaseProbe({...req,method:'POST'}));
    assert(!verifiedReleaseProbe({...req,nextUrl:new URL('https://other.example/api/intelligence')}));
    headers.set('x-ya-release-probe',headers.get('x-ya-release-probe')!+'x');
    assert(!verifiedReleaseProbe(req));
    for(const exp of [Math.floor(Date.now()/1000)-1,Math.floor(Date.now()/1000)+3600]){
      const payload=Buffer.from(JSON.stringify({v:1,aud:origin,exp})).toString('base64url');
      headers.set('x-ya-release-probe',payload+'.'+createHmac('sha256','test-service-secret').update(payload).digest('base64url'));
      assert(!verifiedReleaseProbe(req));
    }
  } finally {if(previous===undefined)delete process.env.INTERNAL_API_TOKEN;else process.env.INTERNAL_API_TOKEN=previous;}
});

test('release probes retain the incoming loopback authority despite NextURL normalization',async()=>{
  const {NextRequest}=await import('next/server');
  const previous=process.env.INTERNAL_API_TOKEN;process.env.INTERNAL_API_TOKEN='local-test-secret';
  try {
    const url='http://127.0.0.1:3187/api/investment-themes';
    const request=new NextRequest(url,{headers:{host:'127.0.0.1:3187',...releaseProbeHeaders(url)}});
    assert(verifiedReleaseProbe(request));
  } finally {if(previous===undefined)delete process.env.INTERNAL_API_TOKEN;else process.env.INTERNAL_API_TOKEN=previous;}
});
