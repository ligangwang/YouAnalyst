import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getStorage} from 'firebase-admin/storage';
import {PriceStore,readHead,saveHead} from '../src/lib/price-store/storage';
import {compactPrices} from '../src/lib/price-store/migration';

import {validatePrices} from '../src/lib/price-store/validate';
import {importSqlitePrices} from '../src/lib/price-store/sqlite-import';

async function activate(store:PriceStore){
 const head=await readHead(store.bucket),expected=Number(process.env.PRICE_MIGRATION_EXPECTED_ROWS);
 if(!Number.isSafeInteger(expected)||expected<1)throw Error('Reviewed expected row count required');
 if(head.manifest.source!=='sqlite'||head.manifest.sourceCursor!==head.manifest.sourceFiles||head.manifest.files.reduce((n,f)=>n+f.rows,0)!==expected)throw Error('SQLite coverage mismatch; keep production unchanged');
 await saveHead(store.bucket,head,{...head.manifest,ready:true});return {status:'ready',rows:expected};
}
async function main(){
 const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
 if(!projectId||!bucketName)throw Error('Project and snapshot bucket required');
 const mode=process.env.PRICE_MIGRATION_MODE??'sqlite';
 const budget=Number(process.env.PRICE_MIGRATION_MAX_FILES??10000);
 if(!Number.isSafeInteger(budget)||budget<1||budget>100000)throw Error('Invalid file budget');
 if(!['sqlite','activate','compact','validate','inspect'].includes(mode))throw Error('Invalid migration mode');
 initializeApp({credential:applicationDefault(),projectId});
 const store=new PriceStore(getStorage().bucket(bucketName));
 try{
  const result=mode==='sqlite'?await importSqlitePrices(store,Number(process.env.PRICE_MIGRATION_MAX_FILES??10000)):
   mode==='activate'?await activate(store):
   mode==='validate'?await validatePrices(store):
   mode==='compact'?await compactPrices(store):await readHead(store.bucket).then(h=>({generation:h.generation,ready:h.manifest.ready,files:h.manifest.files.length,rows:h.manifest.files.reduce((n,f)=>n+f.rows,0),watermark:h.manifest.watermark}));
  console.info(JSON.stringify({event:'price_parquet_migration',mode,...result}));
 }finally{await store.close();}
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',event:'price_parquet_migration_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
