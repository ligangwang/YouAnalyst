import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {getFirestore, FieldValue, type Timestamp, type DocumentData} from 'firebase-admin/firestore';
import {readFile, writeFile, appendFile, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {periodicWebsiteMigrationGuard} from './firestore/website-migration-guard';
import {encode, decode} from '../src/lib/central-cache/codec';
import {planInstrumentMigration, type CompanyRow, type InstrumentMigrationPlan} from '../src/lib/instruments/migration';
import {validateInstrument, instrumentId, type Instrument} from '../src/lib/instruments/model';

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i)=>equal(v,b[i]));
  const x=a as DocumentData,y=b as DocumentData;
  return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>equal(x[k],y[k]));
};
async function main() {
  const args=process.argv.slice(2), value=(key:string,fallback:string)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
  if(args.some(a=>!/^--(directory|phase|limit|batch-size|delay-ms)=/.test(a)))throw Error('Unknown argument');
  const directory=resolve(value('directory','artifacts/company-instruments')),phase=value('phase','plan'),projectId=process.env.GCP_PROJECT_ID;
  if(!projectId)throw Error('GCP_PROJECT_ID required');
  const planFile=join(directory,'plan.json');
  if(phase==='plan'){
    const source=decode(JSON.parse(await readFile(join(directory,'source.json'),'utf8'))) as {projectId:string; rows:CompanyRow[]};
    if(source.projectId!==projectId)throw Error('Source project mismatch');
    const plan=planInstrumentMigration(source.rows,projectId,new Date().toISOString());
    await mkdir(directory,{recursive:true});
    await writeFile(planFile,JSON.stringify(encode(plan)),{flag:'wx'});
    const summary={companies:source.rows.length,instruments:plan.instruments.length,aliases:plan.aliases.length,
      types:plan.instruments.reduce<Record<string,number>>((a,r)=>{const k=r.data.instrumentType??'UNVERIFIED';a[k]=(a[k]??0)+1;return a;},{}),
      review:plan.review.reduce<Record<string,number>>((a,r)=>{a[r.reason]=(a[r.reason]??0)+r.ids.length;return a;},{})};
    await writeFile(join(directory,'summary.json'),JSON.stringify(summary,null,2));
    await writeFile(join(directory,'review.json'),JSON.stringify(plan.review,null,2));
    console.log(JSON.stringify(summary));return;
  }
  const plan=decode(JSON.parse(await readFile(planFile,'utf8'))) as InstrumentMigrationPlan;
  if(plan.version!==1||plan.projectId!==projectId||!['instruments','aliases','verify'].includes(phase))throw Error('Invalid plan/phase');
  for(const row of plan.instruments){validateInstrument(row.data);if(row.id!==instrumentId(row.legacyId)||row.data.companyId!==row.companyId)throw Error('Invalid mapping');}
  initializeApp({credential:applicationDefault(),projectId});const db=getFirestore();
  if(phase==='verify'){
    const failures:string[]=[];
    for(let i=0;i<plan.instruments.length;i+=100){
      const group=plan.instruments.slice(i,i+100),docs=await db.getAll(...group.map(r=>db.doc(`instruments/${r.id}`)));
      docs.forEach((doc,j)=>{if(!doc.exists||doc.get('isDeleted')===true||!Object.entries(group[j].data).every(([k,v])=>equal(doc.get(k),v)))failures.push(doc.ref.path);});
    }
    for(let i=0;i<plan.aliases.length;i+=100){
      const group=plan.aliases.slice(i,i+100),docs=await db.getAll(...group.map(r=>db.doc(`companies/${r.id}`)),{fieldMask:['supersededByCompanyId']});
      docs.forEach((doc,j)=>{if(doc.get('supersededByCompanyId')!==group[j].companyId)failures.push(doc.ref.path);});
    }
    const report={verifiedAt:new Date().toISOString(),instruments:plan.instruments.length,aliases:plan.aliases.length,failures};
    await writeFile(join(directory,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;return;
  }
  const limit=Number(value('limit','100')),batchSize=Number(value('batch-size','10')),delayMs=Number(value('delay-ms','1000'));
  if(!Number.isInteger(limit)||limit<1||limit>5000||!Number.isInteger(batchSize)||batchSize<1||batchSize>100||delayMs<1000)throw Error('Invalid batch bounds');
  const logFile=join(directory,`${phase}-applied.jsonl`);
  const prior=await readFile(logFile,'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '';throw e;});
  const finished=new Set(prior.split('\n').filter(Boolean).map(l=>JSON.parse(l).id));
  const all: {id:string; legacyId?:string; companyId:string; sourceUpdateTime:Timestamp; data?:Instrument}[]=phase==='instruments'?plan.instruments:plan.aliases;
  const pending=all.filter(r=>!finished.has(r.id)).slice(0,limit);let applied=0;
  const guard=await periodicWebsiteMigrationGuard(projectId,process.env.MIGRATION_COMPATIBLE_REVISION);
  await guard(true);
  for(let offset=0;offset<pending.length;offset+=batchSize){
    await guard();
    const group=pending.slice(offset,offset+batchSize);
    await db.runTransaction(async tx=>{
      const sourceIds=[...new Set(group.flatMap(r=>[r.legacyId??r.id,r.companyId]))];
      const sources=await tx.getAll(...sourceIds.map(id=>db.doc(`companies/${id}`)),{fieldMask:['cik','isDeleted','supersededByCompanyId']});
      const byId=new Map(sources.map(d=>[d.id,d]));
      const targets=phase==='instruments'?await tx.getAll(...group.map(r=>db.doc(`instruments/${r.id}`))):[];
      for(let j=0;j<group.length;j++){
        const row=group[j],legacyId=row.legacyId??row.id,source=byId.get(legacyId)!,company=byId.get(row.companyId)!;
        if(!source.exists||!company.exists||source.get('isDeleted')===true||company.get('isDeleted')===true)throw Error(`Company unavailable: ${legacyId}`);
        if(legacyId!==row.companyId&&(!source.get('cik')||source.get('cik')!==company.get('cik')))throw Error(`Issuer conflict: ${legacyId}`);
        if(company.get('supersededByCompanyId'))throw Error(`Canonical company changed: ${row.companyId}`);
        if(phase==='instruments'&&row.data){
          const target=targets[j];
          if(target.exists){if(target.get('isDeleted')===true||!Object.entries(row.data).every(([k,v])=>equal(target.get(k),v)))throw Error(`Instrument conflict: ${row.id}`);continue;}
          if(!source.updateTime!.isEqual(row.sourceUpdateTime))throw Error(`Company changed since plan: ${legacyId}`);
          tx.create(db.doc(`instruments/${row.id}`),{...row.data,isDeleted:false,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
        }else{
          if(source.get('supersededByCompanyId')===row.companyId)continue;
          if(source.get('supersededByCompanyId')||!source.updateTime!.isEqual(row.sourceUpdateTime))throw Error(`Company changed since plan: ${legacyId}`);
          tx.update(source.ref,{supersededByCompanyId:row.companyId,updatedAt:FieldValue.serverTimestamp()});
        }
      }
    });
    await appendFile(logFile,group.map(r=>JSON.stringify({id:r.id,at:new Date().toISOString()})).join('\n')+'\n');
    applied+=group.length;
    if(applied%100===0||applied===pending.length)console.log(JSON.stringify({phase,applied,remaining:all.length-finished.size-applied}));
    await delay(delayMs);
  }
  await guard(true);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Migration failed');process.exitCode=1});
