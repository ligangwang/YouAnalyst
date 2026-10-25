import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {Timestamp,type DocumentSnapshot} from 'firebase-admin/firestore';
import {getAdminFirestore} from '../src/lib/firebase/admin';
import {closeLocalCaches} from '../src/lib/local-cache/watch';
import {instrumentId,type Instrument} from '../src/lib/instruments/model';
import {planInstrumentSupportMigration,instrumentMigrationScope} from '../src/lib/instruments/support-migration';

/** Staged operator tool. Dry run is the default; never selects new coverage. */
async function main(){
  const project=process.env.GCP_PROJECT_ID,file=process.argv.find(arg=>arg.startsWith('--source-backup='))?.slice(16);
  if(!project||!file)throw Error('Explicit GCP_PROJECT_ID and --source-backup=<company migration backup> are required');
  const source=JSON.parse(await readFile(file,'utf8')) as {project:string;selected:string[]};
  if(source.project!==project||!Array.isArray(source.selected)||source.selected.length>10_000||source.selected.some(id=>typeof id!=='string'||! /^(US:[A-Z0-9.-]+|XSHG:\d{6}|XSHE:\d{6}|XBSE:\d{6}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id))||new Set(source.selected).size!==source.selected.length)throw Error('Invalid frozen legacy coverage backup');
  const selected=instrumentMigrationScope(source.selected),skippedCompanies=source.selected.filter(id=>!selected.includes(id));
  initializeApp({credential:applicationDefault(),projectId:project});const db=getAdminFirestore();
  const inputs:{id:string;company:Record<string,unknown>;instrument:Instrument|undefined;companyDoc:DocumentSnapshot;instrumentDoc:DocumentSnapshot}[]=[];
  for(let offset=0;offset<selected.length;offset+=100){
    const ids=selected.slice(offset,offset+100),docs=await db.getAll(...ids.flatMap(id=>[db.collection('companies').doc(id),db.collection('instruments').doc(instrumentId(id))]));
    for(let n=0;n<ids.length;n++)inputs.push({id:ids[n],company:docs[n*2].data()??{},instrument:docs[n*2+1].data() as Instrument|undefined,companyDoc:docs[n*2],instrumentDoc:docs[n*2+1]});
  }
  const plan=planInstrumentSupportMigration(inputs,selected),at=Timestamp.now(),write=process.argv.includes('--write');
  await mkdir('output/instrument-onboarding-backups',{recursive:true});
  const backup=`output/instrument-onboarding-backups/${randomUUID()}.json`;
  await writeFile(backup,JSON.stringify({project,sourceBackup:file,mode:write?'write':'preview',selected:plan.map(row=>row.id),skippedCompanies,originals:inputs.map(row=>({id:row.id,company:row.company,instrument:row.instrument}))},null,2),{flag:'wx'});
  let written=0;
  for(let offset=0;write&&offset<plan.length;offset+=5){
    const batch=plan.slice(offset,offset+5);
    await db.runTransaction(async tx=>{
      const docs=await tx.getAll(...batch.flatMap(row=>[db.collection('companies').doc(row.companyId),db.collection('instruments').doc(row.id)]));
      for(let i=0;i<batch.length;i++){
        const original=inputs.find(row=>row.id===batch[i].companyId)!;
        if(!docs[i*2].updateTime?.isEqual(original.companyDoc.updateTime!)||Boolean(docs[i*2+1].exists)!==Boolean(original.instrumentDoc.exists)||(original.instrumentDoc.exists&&!docs[i*2+1].updateTime?.isEqual(original.instrumentDoc.updateTime!)))throw Error('Migration source changed; stop and preview again');
      }
      for(const row of batch)tx.set(db.collection('instruments').doc(row.id),{...(!inputs.find(input=>input.id===row.companyId)!.instrument?{...row.record,createdAt:at}:{}),onboarding:{status:'SUPPORTED',version:1,requestedAt:null,startedAt:null,supportedAt:at,updatedAt:at,blockedReason:null},updatedAt:at},{merge:true});
    });
    const verified=await db.getAll(...batch.map(row=>db.collection('instruments').doc(row.id)));
    for(let i=0;i<batch.length;i++){
      const data=verified[i].data(),original=inputs.find(row=>row.id===batch[i].companyId)!.instrument;
      if(data?.onboarding?.status!=='SUPPORTED'||data.onboarding.version!==1||data.companyId!==batch[i].companyId)throw Error('Instrument migration verification failed');
      if(original)for(const [key,value] of Object.entries(original))if(key!=='onboarding'&&key!=='updatedAt'&&JSON.stringify(data[key])!==JSON.stringify(value))throw Error('Unrelated instrument data changed; stop migration');
    }
    written+=batch.length;console.log(JSON.stringify({written,total:plan.length,backup}));
    if(offset+5<plan.length)await new Promise<void>(resolve=>setTimeout(resolve,1000));
  }
  console.log(JSON.stringify({mode:write?'written':'preview',selected:plan.length,skippedCompanies,written,backup}));
}
main().finally(closeLocalCaches).catch(()=>{console.error('Instrument migration stopped; inspect the saved backup and retry only after review');process.exitCode=1;});
