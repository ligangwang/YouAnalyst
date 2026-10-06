import test from 'node:test';
import assert from 'node:assert/strict';
import {completedCloseDate,dailyPrice,eventPriceReturn,priceBars,signedPercent} from '../../src/lib/intelligence/price-performance';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';

const event=(at:string|null,day='2026-10-02'):IntelligenceEvent=>({id:'e',origin:'US:MU',companyIds:['US:MU'],edgeIds:[],category:'BUSINESS',title:'News',summary:'',published_at:at,publication_date:day,eventDate:null,planned:false,evidence:[]});
const bars=priceBars([{date:'2026-10-01',close:100},{date:'2026-10-02',close:110},{date:'2026-10-05',close:121}],'2026-10-05');
const now=new Date('2026-10-06T16:00:00Z');

test('daily change uses consecutive available sessions, validates prices and excludes future bars',()=>{
  assert.equal(completedCloseDate('US',new Date('2026-10-06T19:59:59Z')),'2026-10-05');
  assert.equal(completedCloseDate('US',new Date('2026-10-06T20:01:00Z')),'2026-10-06');
  assert.equal(completedCloseDate('CN_A',new Date('2026-10-06T07:01:00Z')),'2026-10-06');
  assert.deepEqual(dailyPrice(bars,'US'),{close:121,currency:'USD',tradingDate:'2026-10-05',previousTradingDate:'2026-10-02',change:121/110-1});
  assert.equal(dailyPrice([{date:'2026-10-02',close:110}],'CN_A')?.change,null);
  assert.equal(dailyPrice([],'US'),undefined);
  assert.equal(priceBars([{date:'2026-02-30',close:3},{date:'2026-10-07',close:3},{date:'2026-10-01',close:NaN},{date:'2026-10-02',close:-1}],'2026-10-05').length,0);
  assert.equal(signedPercent(.0345),'+3.45%');
  assert.equal(signedPercent(-.0123),'-1.23%');
});
test('event baseline respects before/after close, weekends, date-only announcements and company identity',()=>{
  assert.equal(eventPriceReturn(event('2026-10-02T18:00:00Z'),'US:MU',bars,'US',now)?.baselineDate,'2026-10-01');
  assert.equal(eventPriceReturn(event('2026-10-02T21:00:00Z'),'US:MU',bars,'US',now)?.baselineDate,'2026-10-02');
  assert.equal(eventPriceReturn(event('2026-10-03T12:00:00Z'),'US:MU',bars,'US',now)?.baselineDate,'2026-10-02');
  const dated=eventPriceReturn(event(null),'US:MU',bars,'US',now)!;
  assert.equal(dated.dateOnly,true);assert.equal(dated.baselineDate,'2026-10-01');assert.ok(Math.abs(dated.change-.21)<1e-12);
  assert.equal(eventPriceReturn(event(null),'US:AAPL',bars,'US',now),undefined);
});
test('future/planned events, missing baseline and no post-publication close do not fabricate a return',()=>{
  assert.equal(eventPriceReturn({...event(null),planned:true},'US:MU',bars,'US',now),undefined);
  assert.equal(eventPriceReturn(event('2026-10-07T12:00:00Z'),'US:MU',bars,'US',now),undefined);
  assert.equal(eventPriceReturn(event('2026-10-05T21:00:00Z'),'US:MU',bars,'US',now),undefined);
  assert.equal(eventPriceReturn(event(null), 'US:MU',bars.slice(1),'US',now),undefined);
});
test('China timezone and US daylight saving determine the completed pre-announcement close',()=>{
  const cn={...event('2026-10-02T07:01:00Z'),origin:'XSHG:600000',companyIds:['XSHG:600000']};
  assert.equal(eventPriceReturn(cn,'XSHG:600000',bars,'CN_A',now)?.baselineDate,'2026-10-02');
  const winter=priceBars([{date:'2026-01-05',close:100},{date:'2026-01-06',close:110},{date:'2026-01-07',close:120}],'2026-01-07');
  assert.equal(eventPriceReturn(event('2026-01-06T20:30:00Z','2026-01-06'),'US:MU',winter,'US',now)?.baselineDate,'2026-01-05');
  const holiday=priceBars([{date:'2026-11-25',close:100},{date:'2026-11-27',close:110},{date:'2026-11-30',close:120}],'2026-11-30');
  assert.equal(eventPriceReturn(event('2026-11-27T19:00:00Z','2026-11-27'),'US:MU',holiday,'US',new Date('2026-12-01T16:00:00Z'))?.baselineDate,'2026-11-27');
});
