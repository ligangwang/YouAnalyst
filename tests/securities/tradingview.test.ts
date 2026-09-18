import test from 'node:test';
import assert from 'node:assert/strict';
import { tradingViewSymbol } from '../../src/lib/tradingview';

test('quote symbols preserve the known listing venue and Chinese leading zeros', () => {
  assert.equal(tradingViewSymbol('AMD', 'NASDAQ'), 'NASDAQ:AMD');
  assert.equal(tradingViewSymbol('TSM', 'NYSE'), 'NYSE:TSM');
  assert.equal(tradingViewSymbol('XSHE:002156'), 'SZSE:002156');
  assert.equal(tradingViewSymbol('XSHG:688981'), 'SSE:688981');
  assert.equal(tradingViewSymbol('AMD', null), null);
  assert.equal(tradingViewSymbol('PRIVATE', 'UNKNOWN'), null);
});
