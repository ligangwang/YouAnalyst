import {Firestore} from '@google-cloud/firestore';
import {Storage,type StorageOptions} from '@google-cloud/storage';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {loadCollectionUniverse} from '../src/lib/company-themes/service';
import {usMapTickers} from '../src/lib/knowledge-graph/us-companies';
import {cnMapCompanies} from '../src/lib/knowledge-graph/cn-companies';
import {normalizeHistoryPrices} from '../src/lib/predictions/normalize-history-prices';

async function main(){
  const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.EODHD_BULK_EOD_BUCKET;
  if(!projectId||!bucketName)throw Error('Project and existing price cache bucket required');
  const sdkRequire=createRequire(createRequire(resolve('package.json')).resolve('@google-cloud/storage'));
  const {OAuth2Client}=sdkRequire('google-auth-library') as typeof import('google-auth-library');
  const authClient=process.env.GOOGLE_OAUTH_ACCESS_TOKEN?new OAuth2Client():undefined;
  authClient?.setCredentials({access_token:process.env.GOOGLE_OAUTH_ACCESS_TOKEN});
  const db=new Firestore({projectId,authClient,preferRest:true});
  const graph=await loadCollectionUniverse(db,{nodes:[],relationships:[],sources:[],asOf:''});
  const result=await normalizeHistoryPrices({db,bucket:new Storage({projectId,authClient:authClient as unknown as StorageOptions['authClient']}).bucket(bucketName),tickers:[...usMapTickers(graph),...cnMapCompanies(graph)],write:process.argv.includes('--write'),onProgress:result=>{if(result.stocks%10===0)console.log(JSON.stringify(result));}});
  console.log(JSON.stringify({write:process.argv.includes('--write'),...result}));
  if(result.missing)process.exitCode=1;
}
main().catch(()=>{console.error('Stored price normalization failed; no provider requests were made.');process.exitCode=1;});
