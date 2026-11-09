import {AsyncLocalStorage} from 'node:async_hooks';
import {pathToFileURL} from 'node:url';
import {Watch as FixedWatch} from '../../../src/lib/local-cache/watch';

async function main() {
  // An optional old implementation makes this same workload a before/after
  // diagnostic without changing the production source or needing Firestore.
  const Watch: typeof FixedWatch = process.argv[2]
    ? (await import(pathToFileURL(process.argv[2]).href)).Watch : FixedWatch;
  const requests = new AsyncLocalStorage<object>();
  const requestRefs: WeakRef<object>[] = [], initialRefs: WeakRef<object>[] = [];
  const callbacks: Array<(value:object)=>void> = [];
  const watches: FixedWatch<object>[] = [];
  function populate() {for(let i=0;i<100;i++) {
    const request = {renderCache: Array(32768).fill(i)};
    requestRefs.push(new WeakRef(request));
    requests.run(request, () => {
      watches.push(new Watch<object>(next => {
        callbacks.push(next);
        const timer = setInterval(() => {}, 60_000);timer.unref();
        return () => clearInterval(timer);
      }));
    });
    const initial = {rows: Array(32768).fill(i)};
    initialRefs.push(new WeakRef(initial));
    callbacks[i](initial);
    callbacks[i]({current:i});
  }}
  populate();
  // End the WeakRef creation job before collecting; don't dereference between
  // collections, since that would itself keep each target alive for the job.
  for(let i=0;i<5;i++) {await new Promise(resolve=>setImmediate(resolve));global.gc!();}
  const result = {
    retainedRequests: requestRefs.filter(ref=>ref.deref()).length,
    retainedInitialSnapshots: initialRefs.filter(ref=>ref.deref()).length,
    heapUsed: process.memoryUsage().heapUsed,
    latestValues: (await Promise.all(watches.map(watch=>watch.read()))).map(value=>(value as {current:number}).current),
  };
  for(const watch of watches)watch.close();
  console.log(JSON.stringify(result));
}
void main();
