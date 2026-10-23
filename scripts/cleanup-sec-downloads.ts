import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {configuredSecDocumentCache} from '../src/lib/sec-filings/document-cache';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||!process.env.GCP_PROJECT_ID||!process.env.SEC_DOCUMENT_CACHE_BUCKET)throw new Error('Usage: cleanup-sec-downloads [--apply], with project and cache bucket configured');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const cache=configuredSecDocumentCache()!;
cache.cleanup({deadline:Date.now()+8*60000,maxDeletes:100,apply:args.includes('--apply')}).then(result=>console.log(JSON.stringify({job:'cleanup-sec-downloads',...result}))).catch(error=>{console.error(error instanceof Error?error.message:'SEC cache cleanup failed');process.exitCode=1;});
