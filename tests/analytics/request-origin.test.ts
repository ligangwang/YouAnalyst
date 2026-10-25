import assert from 'node:assert/strict';
import test from 'node:test';
import {hasTrustedRequestOrigin} from '../../src/lib/request-origin';

test('browser mutations accept configured public origin behind Cloud Run without trusting forwarded hosts',()=>{
  const request=(origin?:string,extra:Record<string,string>={})=>new Request('http://0.0.0.0:8080/api/instrument-onboarding/requests',{headers:{...(origin?{origin}:{}),...extra}});
  const site='https://youanalyst.com';
  assert.equal(hasTrustedRequestOrigin(request(site),site),true);
  assert.equal(hasTrustedRequestOrigin(request(),site),true);
  assert.equal(hasTrustedRequestOrigin(request('https://evil.example',{'x-forwarded-host':'evil.example',host:'evil.example'}),site),false);
  assert.equal(hasTrustedRequestOrigin(request(site,{'sec-fetch-site':'cross-site'}),site),false);
  for(const origin of ['null',site+'/path','https://youanalyst.com.evil.example','http://youanalyst.com','https://user@youanalyst.com'])assert.equal(hasTrustedRequestOrigin(request(origin),site),false);
  assert.equal(hasTrustedRequestOrigin(new Request('http://localhost:3000/api',{headers:{origin:'http://localhost:3000'}}),undefined),true);
  assert.equal(hasTrustedRequestOrigin(request(site),'invalid'),false);
});
