import test from 'node:test';
import assert from 'node:assert/strict';
import {historyBars} from '../../src/lib/predictions/history-bars';

test('partial history admits a real dated close without fabricating unavailable fields',()=>{
  const rows=historyBars([{date:'2026-01-02',close:12,open:0,high:0,low:0,adjusted_close:0,volume:null},{date:'2026-01-03',close:0}], '2020-12-30','2026-11-05',true);
  assert.deepEqual(rows,[{date:'2026-01-02',close:12,open:null,high:null,low:null,adjusted_close:null,volume:null}]);
  assert.throws(()=>historyBars([{date:'2026-01-02',close:12}],'2020-12-30','2026-11-05'),/Invalid historical bar/);
});
test('partial coverage accepts missing days while excluding invalid dates, out-of-range and invalid closes',()=>{
  const rows=historyBars([{date:'2026-01-02',close:12},{date:'2026-10-30',close:14},{date:'2026-02-30',close:7},{date:'2019-01-01',close:10},{date:'2026-01-03',close:-1}], '2020-12-30','2026-11-05',true);
  assert.deepEqual(rows.map(row=>row.date),['2026-01-02','2026-10-30']);
});
test('partial history requires at least one unambiguous valid price',()=>{
  for(const input of [[],[{date:'2026-01-02',close:0}],[{date:'2026-01-02',close:12},{date:'2026-01-02',close:15}]])assert.throws(()=>historyBars(input,'2020-12-30','2026-11-05',true),/Empty or invalid/);
  assert.equal(historyBars([{date:'2026-01-02',close:12},{date:'2026-01-02',close:12}],'2020-12-30','2026-11-05',true).length,1);
});
