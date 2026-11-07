import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {completeMarketEodRun} from '../../src/lib/predictions/latest-eod-run';

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
