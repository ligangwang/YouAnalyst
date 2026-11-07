import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {completeMarketEodRun} from '../../src/lib/predictions/latest-eod-run';
import {readCompletedEodDates} from '../../src/lib/ui/completed-eod-dates';

test('market dates include completed runs with coverage gaps and exclude unfinished or invalid pointers',async()=>{
 const f=pubsubFirestore();
 assert.deepEqual(await readCompletedEodDates(f.db),{US:null,CN_A:null});
 await completeMarketEodRun(f.db,'US','2026-11-06','COMPLETED_WITH_ERRORS','Missing bars',true);
 await completeMarketEodRun(f.db,'CN_A','2026-11-05','COMPLETED',null,true);
 assert.deepEqual(await readCompletedEodDates(f.db),{US:'2026-11-06',CN_A:'2026-11-05'});
 f.rows.set('eod_runs/_latest_US',{market:'US',runDate:'2026-11-07',status:'STARTED'});
 f.rows.set('eod_runs/_latest_CN_A',{market:'CN_A',runDate:'invalid',status:'COMPLETED'});
 assert.deepEqual(await readCompletedEodDates(f.db),{US:null,CN_A:null});
});

test('only finalized full-market runs advance a monotonic per-market date',async()=>{
 const f=pubsubFirestore();
 await completeMarketEodRun(f.db,'US','2026-11-05','COMPLETED',null,true);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-05');
 await completeMarketEodRun(f.db,'US','2026-11-06','COMPLETED_WITH_ERRORS','Missing bar',true);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
 assert.equal(f.rows.get('eod_runs/_latest_US')?.status,'COMPLETED_WITH_ERRORS');
 await completeMarketEodRun(f.db,'US','2026-11-07','COMPLETED',null,false);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
 await completeMarketEodRun(f.db,'US','2026-11-04','COMPLETED',null,true);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
 await completeMarketEodRun(f.db,'CN_A','2026-11-06','COMPLETED',null,true);
 assert.equal(f.rows.get('eod_runs/_latest_CN_A')?.runDate,'2026-11-06');
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
 await completeMarketEodRun(f.db,'US','2026-11-06','COMPLETED',null,true);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
});
