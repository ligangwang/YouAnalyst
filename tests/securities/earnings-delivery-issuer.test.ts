import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import type {Firestore} from 'firebase-admin/firestore';
import {withDeliveryIssuer} from '../../src/lib/earnings/delivery-issuer';
import {earningsCompany, earningsCompanies, restoreEarningsFixtures} from '../../src/lib/earnings/issuers';

function fixture() {
  const companies = new Map<string, Record<string, unknown>>([
    ['US:A',{name:'Alpha',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}}],
    ['US:B',{name:'Beta',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}}],
    ['XSHE:301308',{name:'Longsys',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}}],
  ]);
  const identities = new Map([
    ['sec-identity-US:A',{companyId:'US:A',cik:'0000000001'}],
    ['sec-identity-US:B',{companyId:'US:B',cik:'0000000002'}],
  ]);
  const companyReads:string[]=[], identityReads:string[][]=[];
  const db={
    collection:(name:string)=>({
      doc:(id:string)=>{assert.equal(name,'companies');return {id};},
      where:(_field:unknown,op:string,ids:string[])=>{
        assert.equal(name,'collectors');assert.equal(op,'in');
        return {get:async()=>{identityReads.push(ids);return {docs:ids.filter(id=>identities.has(id)).map(id=>({id,data:()=>identities.get(id)}))};}};
      },
    }),
    getAll:async(ref:{id:string},options:{fieldMask:string[]})=>{
      assert(options.fieldMask.includes('onboarding.status'));
      companyReads.push(ref.id);
      return [{exists:companies.has(ref.id),data:()=>companies.get(ref.id)}];
    },
  } as unknown as Firestore;
  return {db,companies,identities,companyReads,identityReads};
}

test('parallel deliveries read only their issuer and never share mutable issuer maps',async()=>{
  restoreEarningsFixtures();const f=fixture();const before=earningsCompanies();
  await Promise.all(['US:A','US:B','XSHE:301308'].map(id=>withDeliveryIssuer(f.db,id,async()=>{
    await setImmediate();
    assert.deepEqual(earningsCompanies().map(company=>company.companyId),[id]);
    assert.equal(earningsCompany(id).companyId,id);
    assert.throws(()=>earningsCompany(id==='US:A'?'US:B':'US:A'));
  })));
  assert.deepEqual(f.companyReads.sort(),['US:A','US:B','XSHE:301308']);
  assert.deepEqual(f.identityReads.sort(),[['sec-identity-US:A'],['sec-identity-US:B']]);
  assert.deepEqual(earningsCompanies(),before);
});

test('unsupported, missing, mismatched and invalid identities cannot run delivery work',async()=>{
  const f=fixture();let runs=0;const work=async()=>{runs++;};
  await assert.rejects(withDeliveryIssuer(f.db,'US:ABSENT',work),/not supported/);
  f.companies.get('US:A')!.onboarding={status:'BLOCKED'};
  await assert.rejects(withDeliveryIssuer(f.db,'US:A',work),/not supported/);
  f.identities.delete('sec-identity-US:B');
  await assert.rejects(withDeliveryIssuer(f.db,'US:B',work),/no verified/);
  f.identities.set('sec-identity-US:B',{companyId:'US:OTHER',cik:'0000000002'});
  await assert.rejects(withDeliveryIssuer(f.db,'US:B',work),/no verified/);
  await assert.rejects(withDeliveryIssuer(f.db,'../../other',work),/Invalid/);
  assert.equal(runs,0);
});
