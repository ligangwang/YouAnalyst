import { Firestore } from '@google-cloud/firestore';
import { Storage, type StorageOptions } from '@google-cloud/storage';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadCollectionUniverse } from '../src/lib/company-themes/service';
import { usMapTickers } from '../src/lib/knowledge-graph/us-companies';
import { cnMapCompanies } from '../src/lib/knowledge-graph/cn-companies';
import { backfillPriceHistory, HISTORY_START, historyThrough } from '../src/lib/predictions/history-backfill';

async function main() {
const projectId = process.env.GCP_PROJECT_ID;
if (!projectId) throw Error('GCP_PROJECT_ID required');
const capturedToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
// Use the clients' own auth-library version (its header format differs from the root dependency).
const sdkRequire=createRequire(createRequire(resolve('package.json')).resolve('@google-cloud/storage'));
const {OAuth2Client}=sdkRequire('google-auth-library') as typeof import('google-auth-library');
const authClient=capturedToken ? new OAuth2Client() : undefined;
authClient?.setCredentials({access_token:capturedToken});
const db=new Firestore({projectId,authClient,preferRest:true});
const graph=await loadCollectionUniverse(db,{nodes:[],relationships:[],sources:[],asOf:new Date().toISOString()});
const universes={US:usMapTickers(graph),CN_A:cnMapCompanies(graph)};
const now=new Date();
const limit=Number(process.argv.find(value=>value.startsWith('--limit='))?.split('=')[1] ?? 1000);
if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid backfill limit');
console.log(JSON.stringify({from:HISTORY_START,markets:Object.entries(universes).map(([market,tickers])=>({market,through:historyThrough(market as 'US'|'CN_A',now),stocks:tickers.length})),
  excluded:graph.nodes.filter(n=>n.kind==='COMPANY'&&!n.id.startsWith('US:')&&!/^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(n.id)).map(n=>({id:n.id,name:n.name}))}));
if (process.argv.includes('--write')) {
  const bucketName=process.env.EODHD_BULK_EOD_BUCKET;
  if (!bucketName || !process.env.EODHD_API_TOKEN) throw Error('Existing EODHD token and cache bucket required');
  for (const market of ['US','CN_A'] as const) {
    // Storage and Firestore resolve different google-auth type versions; both accept OAuth2 request headers.
    const result=await backfillPriceHistory({db,bucket:new Storage({projectId,authClient:authClient as unknown as StorageOptions['authClient']}).bucket(bucketName),tickers:universes[market],
      through:historyThrough(market,now),limit,token:process.env.EODHD_API_TOKEN});
    console.log(JSON.stringify({market,...result}));
    if (result.failures.length) process.exitCode=1;
  }
}
}
main().catch((error: unknown)=>{
  let message=error instanceof Error ? error.message : 'Unknown error';
  for(const secret of [process.env.GOOGLE_OAUTH_ACCESS_TOKEN,process.env.EODHD_API_TOKEN]) if(secret) message=message.replaceAll(secret,'[redacted]');
  console.error(JSON.stringify({error:'Historical backfill failed',message}));process.exitCode=1;
});
