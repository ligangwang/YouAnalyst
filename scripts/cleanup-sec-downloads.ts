import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {configuredSecDocumentCache} from '../src/lib/sec-filings/document-cache';
import {getAdminStorageBucket} from '../src/lib/firebase/admin';
import {getFirestore} from 'firebase-admin/firestore';
import {cleanSecBulkFiles,cleanEodBulkFiles} from '../src/lib/fundamentals/bulk-cleanup';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||!process.env.GCP_PROJECT_ID||!process.env.SEC_DOCUMENT_CACHE_BUCKET)throw new Error('Usage: cleanup-sec-downloads [--apply], with project and cache bucket configured');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const cache=configuredSecDocumentCache()!;
async function main(){
  const apply=args.includes('--apply');
  const result=await cache.cleanup({deadline:Date.now()+8*60000,maxDeletes:100,apply});
  console.log(JSON.stringify({job:'cleanup-sec-downloads',...result}));
  if(process.env.ENTITY_SNAPSHOT_BUCKET){
    const bulk=await cleanSecBulkFiles(getAdminStorageBucket(process.env.ENTITY_SNAPSHOT_BUCKET),{apply});
    console.log(JSON.stringify({job:'cleanup-sec-financial-bulk',...bulk}));
  }
  if(process.env.EODHD_BULK_EOD_BUCKET){
    const bulk=await cleanEodBulkFiles(getFirestore(),getAdminStorageBucket(process.env.EODHD_BULK_EOD_BUCKET),{apply});
    console.log(JSON.stringify({job:'cleanup-eodhd-bulk',...bulk}));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'SEC cache cleanup failed');process.exitCode=1;});
