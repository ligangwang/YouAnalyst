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

test('SEC company scope sends both predicates to Firestore before reading documents', async () => {
  const predicates: unknown[][] = [];
  let reads = 0;
  const query = {
    where(...args: unknown[]) { predicates.push(args); return query; },
    async get() {
      assert.deepEqual(predicates, [
        ['themeIds', 'array-contains-any', ['ai', 'robotics', 'space']],
        ['exchange_region', '==', 'US'],
      ]);
      reads++;
      return { docs: [] };
    },
  };
  const db = { collection(name: string) { assert.equal(name, 'companies'); return query; } };
  await loadCollectionCompanyScope(withThemeCatalog(db as unknown as Firestore), 'US');
  assert.equal(reads, 1);
});
