import {AsyncResource} from 'node:async_hooks';
import {getHeapStatistics} from 'node:v8';

declare global {
  var __youAnalystCacheScopeV1: AsyncResource | undefined;
  var __youAnalystCacheMemoryTimerV1: ReturnType<typeof setInterval> | undefined;
}
// Instrumentation imports this before accepting requests. Share it across route
// bundles: creating a new resource inside a request (even with triggerAsyncId: 0)
// would copy that request's AsyncLocalStorage stores into every listener/timer.
const scope = globalThis.__youAnalystCacheScopeV1 ??= new AsyncResource('youanalyst-cache');

/** Only subscription setup belongs here; callers still await in their own scope. */
export function inCacheScope<T>(work: () => T): T {
  return scope.runInAsyncScope(work);
}

/** One local measurement per minute; no database queries or persisted fields. */
export function startCacheMemoryTelemetry() {
  if(globalThis.__youAnalystCacheMemoryTimerV1)return;
  inCacheScope(()=>{
    const report=()=>{
      const memory=process.memoryUsage();
      console.info(JSON.stringify({event:'cache_memory',revision:process.env.K_REVISION,
        processRunId:globalThis.__youAnalystFirestoreObserverV1?.processRunId,
        uptimeSeconds:Math.round(process.uptime()),...memory,
        heapLimit:getHeapStatistics().heap_size_limit,
        activeWatches:globalThis.__youAnalystActiveWatchesV1?.size??0}));
    };
    report();
    globalThis.__youAnalystCacheMemoryTimerV1=setInterval(report,60_000);
    globalThis.__youAnalystCacheMemoryTimerV1.unref();
  });
}
