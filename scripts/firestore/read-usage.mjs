import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const project=process.env.GCP_PROJECT_ID;
assert(project,'GCP_PROJECT_ID is required');
const end=new Date(process.env.USAGE_END_AT||Date.now());
const start=new Date(process.env.USAGE_START_AT||end.getTime()-24*3_600_000);
assert(Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&start<end,'Invalid usage interval');
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
const result={project,start:start.toISOString(),end:end.toISOString(),commit:process.env.GITHUB_SHA??null,metrics:{}};
for(const kind of ['read','write','delete']){
  const points=[];
  let pageToken='';
  do{
    const url=new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
    const params={filter:`metric.type="firestore.googleapis.com/document/${kind}_count"`,'interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':'ALIGN_SUM','aggregation.crossSeriesReducer':'REDUCE_SUM',view:'FULL',pageSize:'1000',...(pageToken?{pageToken}:{})};
    Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error(`Monitoring ${kind} request failed (${response.status})`);
    const data=await response.json();
    points.push(...(data.timeSeries??[]).flatMap(series=>(series.points??[]).map(point=>({end:point.interval.endTime,count:Number(point.value.int64Value??point.value.doubleValue??0)}))));
    pageToken=data.nextPageToken??'';
  }while(pageToken);
  result.metrics[kind]={total:points.length?points.reduce((total,point)=>total+point.count,0):null,hourly:points.sort((a,b)=>a.end.localeCompare(b.end))};
}
mkdirSync('artifacts/firestore-usage',{recursive:true});
const name=process.env.USAGE_LABEL||'report';
assert(/^[a-z0-9-]+$/.test(name),'Invalid report label');
writeFileSync(`artifacts/firestore-usage/${name}.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
