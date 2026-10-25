import {withThemeCatalog} from './helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { exchangeRegion } from '../src/lib/market-companies/exchange-region';
import { loadCollectionCompanyScope } from '../src/lib/company-themes/service';

test('listing region follows canonical identity, including US ADRs', () => {
  assert.equal(exchangeRegion('US:BABA'), 'US');
  assert.equal(exchangeRegion('XSHG:600000'), 'CN');
  assert.equal(exchangeRegion('XSHE:000063'), 'CN');
  assert.equal(exchangeRegion('ORG:OPENAI'), null);
  assert.equal(exchangeRegion('UNKNOWN:ABC'), null);
});

test('SEC company scope uses the single supported index without requiring a composite region index', async () => {
  const predicates: unknown[][] = [];
  let reads = 0;
  const query = {
    where(...args: unknown[]) { predicates.push(args); return query; },
    async get() {
      assert.deepEqual(predicates, [
        ['onboarding.status', '==', 'SUPPORTED'],
      ]);
      reads++;
      return { docs: [] };
    },
  };
  const db = { collection(name: string) { assert.equal(name, 'companies'); return query; } };
  await loadCollectionCompanyScope(withThemeCatalog(db as unknown as Firestore), 'US');
  assert.equal(reads, 1);
});
