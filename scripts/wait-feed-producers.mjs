import {execFileSync} from 'node:child_process';
const jobs=[];
if(process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED==='1')jobs.push('collect-intelligence-news-production');
if(process.env.ENABLE_SEC_FILING_PIPELINE==='1')jobs.push('collect-sec-filings-production');
if(process.env.EARNINGS_PIPELINE_ENABLED==='1')jobs.push('collect-earnings-production');
const waitEod=['all','fundamentals','eod-maintenance'].includes(process.env.TARGET_JOB??'');
const token=waitEod?execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim():'';
for(let attempt=0;attempt<60;attempt++){
  const active=[];
  for(const job of jobs){
    const executions=JSON.parse(execFileSync('gcloud',['run','jobs','executions','list','--job',job,'--project',process.env.GCP_PROJECT_ID,'--region',process.env.GCP_REGION||'us-central1','--limit=30','--format=json'],{encoding:'utf8'}));
    for(const execution of executions){
      const completed=execution.status?.conditions?.find(condition=>condition.type==='Completed');
      if(!execution.status?.completionTime&&(!completed||completed.status==='Unknown'))active.push(execution.metadata.name);
    }
  }
  if(waitEod)for(const market of ['US','CN_A']){
    const url=`https://firestore.googleapis.com/v1/projects/${process.env.GCP_PROJECT_ID}/databases/(default)/documents/eod_runs/_queue_${market}`;
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30_000)});
    if(response.status===404)continue;
    if(!response.ok)throw Error(`Could not check EOD lease (${response.status}); web rollout withheld`);
    const fields=(await response.json()).fields??{};
    if(Number(fields.leaseExpiresAtMs?.integerValue??fields.leaseExpiresAtMs?.doubleValue??0)>Date.now())active.push(`EOD ${market}`);
  }
  if(!active.length){console.log('No pre-rollout feed producer executions remain.');process.exit(0);}
  console.log(`Waiting for feed producers to finish: ${active.join(', ')}`);
  await new Promise(resolve=>setTimeout(resolve,15_000));
}
throw Error('Feed producers did not drain within 15 minutes; web rollout withheld');
