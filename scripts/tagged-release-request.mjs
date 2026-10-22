import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// Cloud Run route changes may precede tagged URL readiness. Never retry other
// failures, and never turn a persistent 404 into a successful release check.
export async function taggedReleaseRequest(url, options, {
  request=fetch, sleep=ms=>delay(ms), log=console.log, beforeRetry=async()=>{},
  attempts=7, interval=5000,
}={}) {
  assert(Number.isInteger(attempts)&&attempts>0);
  for(let attempt=1;attempt<=attempts;attempt++) {
    const response=await request(url,{...options,signal:AbortSignal.timeout(30000),cache:'no-store'});
    if(response.status!==404||!['GET','HEAD'].includes((options?.method??'GET').toUpperCase()))return response;
    log(JSON.stringify({event:'release_probe',target:'tagged',path:new URL(url).pathname,status:404,attempt,attempts}));
    if(attempt===attempts)return response;
    await response.body?.cancel();
    await beforeRetry();
    await sleep(interval);
  }
}
