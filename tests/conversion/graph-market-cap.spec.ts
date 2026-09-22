import { test, expect } from '@playwright/test';
import { marketCapScale, marketCapLabel } from '../../src/lib/knowledge-graph/market-cap';
test('market cap areas scale proportionally within limits and unknown retains default', () => {
 const cap=(value:number)=>({value,currency:'USD' as const,priceDate:'2026-09-21'});
 expect(marketCapScale(cap(400e9))/marketCapScale(cap(100e9))).toBe(2);
 expect(marketCapScale()).toBe(1);
 expect(marketCapScale(cap(NaN))).toBe(1);
 expect(marketCapScale(cap(0))).toBe(1);
 expect(marketCapScale(cap(1e6))).toBe(.65);
 expect(marketCapScale(cap(10e12))).toBe(2.5);
 expect(marketCapLabel(cap(1e12))).toBe('$1T');
 expect(marketCapLabel()).toBe('');
});
