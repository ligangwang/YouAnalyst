import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// These exact probes carry no body, credentials or cookies. The API rejects
// them before any write. Never apply this exception to general POST requests.
export async function taggedUnauthenticatedProbe(url,{request=fetch,sleep=ms=>delay(ms),log=console.log,attempts=7}={}){
  assert(Number.isInteger(attempts)&&attempts>0&&attempts<=7,'Invalid authentication probe bound');
  assert(/^\/api\/compare\/community(?:\/[a-f0-9]{64}\/(?:vote|comments))?$/.test(new URL(url).pathname),'Unsupported authentication probe');
  for(let attempt=1;attempt<=attempts;attempt++){
    const response=await request(url,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(response.status!==404||!response.headers?.get('content-type')?.includes('text/html'))return response;
    if(!(await response.clone().text()).includes('The requested URL was not found on this server')||attempt===attempts)return response;
    log(JSON.stringify({event:'release_auth_probe',path:new URL(url).pathname,status:404,attempt,attempts}));
    await response.body?.cancel();await sleep(5000);
  }
  throw Error('Authentication probe exhausted');
}

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
  throw new Error('Tagged release probe exhausted without a response');
}
