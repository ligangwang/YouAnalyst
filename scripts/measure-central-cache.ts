import { Firestore } from '@google-cloud/firestore';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { CentralCache } from '../src/lib/central-cache/store';
import { firestoreSource } from '../src/lib/central-cache/source';
import { encode } from '../src/lib/central-cache/codec';
async function main(){
  const projectId=process.env.GCP_PROJECT_ID;if(!projectId)throw Error('GCP_PROJECT_ID required');
  const firestoreRequire=createRequire(createRequire(resolve('package.json')).resolve('@google-cloud/firestore'));
  const sdkRequire=createRequire(firestoreRequire.resolve('google-gax'));
  const {OAuth2Client}=sdkRequire('google-auth-library') as typeof import('google-auth-library');
  const authClient=process.env.GOOGLE_OAUTH_ACCESS_TOKEN?new OAuth2Client():undefined;authClient?.setCredentials({access_token:process.env.GOOGLE_OAUTH_ACCESS_TOKEN});
  const db=new Firestore({projectId,auth:authClient,preferRest:true}), cache=new CentralCache(firestoreSource(db));
  const baseline=process.memoryUsage();await cache.warm();cache.relationships({status:'PUBLISHED'});const warm=cache.stats();
  // Retain 20 full fundamentals responses concurrently to measure serialization
  // headroom. This is a local stress sample, not a container load test.
  let peak=process.memoryUsage().rss;
  for(let round=0;round<10;round++){
    const responses=Array.from({length:20},()=>JSON.stringify(encode(cache.read('company_fundamentals'))));
    peak=Math.max(peak,process.memoryUsage().rss);
    await new Promise(resolve=>setImmediate(resolve));
    if(responses.some(response=>!response.length))throw Error('Empty response');
  }
  const report={concurrency:20,projectId,at:new Date().toISOString(),baseline,warm,peakRssBytes:peak,passes512MiBHeadroom:peak<350*1024*1024,passes1GiBHeadroom:peak<700*1024*1024,notes:'Read-only production sample; local Node process, not a Linux container memory limit test.'};
  await writeFile('artifacts/central-cache-memory.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await db.terminate();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
