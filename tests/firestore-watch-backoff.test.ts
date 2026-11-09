/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise the installed SDK's private watch state machine. */
import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
const require = createRequire(import.meta.url);
const {DocumentWatch} = require('@google-cloud/firestore/build/src/watch.js');
const backoff = require('@google-cloud/firestore/build/src/backoff.js');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(t: TestContext) {
  const timers: Array<{callback:()=>void;ms:number;cancelled:boolean}> = [];
  t.mock.method(backoff, 'delayExecution', (callback:()=>void, ms:number) => {
    const timer={callback,ms,cancelled:false};timers.push(timer);return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer:any) => {if(timer)timer.cancelled=true;});
  const requests:any[]=[];const errors:Error[]=[];
  const stream=Object.assign(new EventEmitter(),{resume(){},end(){}});
  const db={formattedName:'projects/test/databases/(default)',initializeIfNeeded:async()=>{},unregisterListener(){},requestStream:async(...args:any[])=>{requests.push(args);return stream;}};
  const watch=new DocumentWatch(db,{_converter:{},formattedName:'projects/test/databases/(default)/documents/companies/US:TEST'});
  watch.onError=(error:Error)=>errors.push(error);
  watch.resumeToken=Buffer.from('existing-resume-token');
  watch.resetIdleTimeout();
  t.after(()=>watch.shutdown());
  return {watch,timers,requests,errors};
}
test('transient disconnect cancels stale idle timeout and resumes exactly one stream',async t=>{
  const {watch,timers,requests,errors}=setup(t);const idle=timers[0];
  watch.maybeReopenStream(Object.assign(new Error('transport disconnected'),{code:14}));
  assert.equal(idle.cancelled,true,'stale idle timer must not race reconnect backoff');
  assert.equal(timers.length,2);
  // Advance the pending backoff; a cancelled idle timer must never fire.
  timers[1].callback();await tick();
  assert.equal(errors.length,0);assert.equal(requests.length,1);
  assert.deepEqual(requests[0][2].addTarget.resumeToken,Buffer.from('existing-resume-token'));
  assert.equal(watch.isActive,true);
  assert.equal(timers.length,3,'new stream installs its own idle deadline');
  assert.equal(timers[2].cancelled,false);
});
test('unsubscribe during pending reconnect never opens another stream',async t=>{
  const {watch,timers,requests,errors}=setup(t);
  watch.maybeReopenStream(Object.assign(new Error('transport disconnected'),{code:14}));
  watch.shutdown();timers[1].callback();await tick();
  assert.equal(requests.length,0);assert.equal(errors.length,0);assert.equal(watch.isActive,false);
});
test('permanent watch errors still close and surface without retry',async t=>{
  const {watch,timers,requests,errors}=setup(t);
  watch.maybeReopenStream(Object.assign(new Error('permission denied'),{code:7}));await tick();
  assert.equal(errors.length,1);assert.equal(errors[0].message,'permission denied');
  assert.equal(requests.length,0);assert.equal(timers.length,1);assert.equal(timers[0].cancelled,true);
});

