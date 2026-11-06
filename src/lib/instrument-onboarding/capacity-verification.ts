import {OnboardingCapacityDeferred} from './capacity-control';

/** Deployment probes may straddle a monitor refresh. Processing never waits here. */
export async function verifyOnboardingCapacity(
  check:()=>Promise<void>,
  sleep:(ms:number)=>Promise<void> = ms=>new Promise(resolve=>setTimeout(resolve,ms)),
) {
  // At most seven point reads and sixty seconds of waiting. Every attempt must
  // pass the unchanged freshness/pause check before traffic can be promoted.
  for(let attempt=1;attempt<=7;attempt++) {
    try { await check();return attempt; }
    catch(error) {
      if(!(error instanceof OnboardingCapacityDeferred)||attempt===7)throw error;
      await sleep(10_000);
    }
  }
  throw Error('Capacity verification exhausted');
}
