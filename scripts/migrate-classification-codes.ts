import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {isDeepStrictEqual} from 'node:util';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {classificationCodesPatch} from '../src/lib/industry-classification/migration';

type Row={id:string;before:Record<string,unknown>;updateTime:{seconds:number;nanoseconds:number};patch:NonNullable<ReturnType<typeof classificationCodesPatch>>};
async function main(){
 const args=process.argv.slice(2),value=(key:string,fallback:string)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
 if(args.some(a=>!/^--(phase|directory|limit|batch-size|compatible-revision)=/.test(a)))throw Error('Unknown argument');
 const phase=value('phase','plan'),directory=resolve(value('directory','artifacts/taxonomy-codes/migration')),projectId=process.env.GCP_PROJECT_ID;
 if(!projectId||!['plan','apply','verify'].includes(phase))throw Error('Project and valid phase required');
 initializeApp({credential:applicationDefault(),projectId});const db=getFirestore();await mkdir(directory,{recursive:true});
 const planPath=join(directory,'plan.json');
 if(phase==='plan'){
  const snapshot=await db.collection('companies').where('taxonomy','in',['SIC','CNI']).select('taxonomy','classification','classificationMetadata','isDeleted').get();
  const rows:Row[]=[],counts:Record<string,number>={};
  for(const doc of snapshot.docs){const before=doc.data(),patch=classificationCodesPatch(before);if(!patch)continue;
   counts[before.taxonomy]=(counts[before.taxonomy]??0)+1;rows.push({id:doc.id,before,patch,updateTime:{seconds:doc.updateTime.seconds,nanoseconds:doc.updateTime.nanoseconds}});
  }
  const plan={projectId,createdAt:new Date().toISOString(),counts,rows};
  await writeFile(planPath,JSON.stringify(plan,null,2),{flag:'wx'});console.log(JSON.stringify({scanned:snapshot.size,planned:rows.length,counts}));return;
 }
 const plan=JSON.parse(await readFile(planPath,'utf8')) as {projectId:string;rows:Row[]};
 if(plan.projectId!==projectId)throw Error('Project mismatch');
 for(const row of plan.rows)if(!row.id||row.id.includes('/')||JSON.stringify(classificationCodesPatch(row.before))!==JSON.stringify(row.patch))throw Error('Invalid migration plan');
 if(phase==='verify'){
  const failures:string[]=[];
  for(let i=0;i<plan.rows.length;i+=100){const group=plan.rows.slice(i,i+100),docs=await db.getAll(...group.map(r=>db.doc(`companies/${r.id}`)),{fieldMask:['taxonomy','classification','classificationMetadata','isDeleted']});
   docs.forEach((doc,j)=>{const row=group[j],data=doc.data();if(!isDeepStrictEqual(data,{...row.before,...row.patch}))failures.push(doc.id);});
  }
  const report={verifiedAt:new Date().toISOString(),checked:plan.rows.length,failures};await writeFile(join(directory,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;return;
 }
 // Operator must first verify the serving revision supports both formats and importers write codes.
 const revision=value('compatible-revision','');if(!/^ifindata-web-[a-z0-9-]+$/.test(revision))throw Error('Verified compatible production revision required before apply');
 const limit=Number(value('limit','100')),batchSize=Number(value('batch-size','10'));
 if(!Number.isInteger(limit)||limit<1||limit>3000||!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw Error('Invalid batch bounds');
 const logPath=join(directory,'applied.jsonl'),prior=await readFile(logPath,'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '';throw e;});
 const finished=new Set(prior.split('\n').filter(Boolean).map(l=>JSON.parse(l).id));const pending=plan.rows.filter(r=>!finished.has(r.id)).slice(0,limit);let applied=0;
 for(let i=0;i<pending.length;i+=batchSize){const group=pending.slice(i,i+batchSize);
  await db.runTransaction(async tx=>{const docs=await tx.getAll(...group.map(r=>db.doc(`companies/${r.id}`)),{fieldMask:['taxonomy','classification','classificationMetadata','isDeleted']});
   docs.forEach((doc,j)=>{const row=group[j],data=doc.data();if(!data)throw Error(`Company missing: ${row.id}`);
    if(isDeepStrictEqual(data,{...row.before,...row.patch}))return;
    // Unrelated edits are safe: compare only the fields this migration depends on.
    // The transaction still retries on concurrent writes between read and commit.
    if(!isDeepStrictEqual(data,row.before))throw Error(`Concurrent classification edit: ${row.id}`);
    tx.update(doc.ref,{...row.patch,updatedAt:FieldValue.serverTimestamp()});
   });
  });
  await appendFile(logPath,group.map(r=>JSON.stringify({id:r.id,at:new Date().toISOString(),revision})).join('\n')+'\n');applied+=group.length;
  if(applied%100===0||applied===pending.length)console.log(JSON.stringify({applied,remaining:plan.rows.length-finished.size-applied}));await delay(1000);
 }
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Classification migration failed');process.exitCode=1;});
