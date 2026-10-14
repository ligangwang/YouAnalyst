import { GoogleAuth } from 'google-auth-library';
import { companySearchMigration } from '../src/lib/market-companies/search-migration';
import { COMPANY_SEARCH_VERSION, RETIRED_COMPANY_SEARCH_FIELDS } from '../src/lib/market-companies/search';
type Value = { stringValue?: string; integerValue?: string; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> } };
function decode(value?: Value): unknown {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.integerValue !== undefined) return Number(value.integerValue);
  if (value?.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value?.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
}
function encode(value: unknown): Value {
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { stringValue: String(value) };
}
async function main() {
  const project = process.env.GCP_PROJECT_ID, apply = process.argv.includes('--apply'), cleanup = process.argv.includes('--cleanup');
  if (!project || !/^[a-z][a-z0-9-]+$/.test(project) || !process.argv.some(arg => arg === '--preview' || arg === '--apply')) throw new Error('Set GCP_PROJECT_ID and use --preview or --apply');
  if (apply && cleanup) {
    const expected = process.argv[process.argv.indexOf('--expected-sha') + 1];
    if (!/^[a-f0-9]{40}$/.test(expected ?? '')) throw new Error('Cleanup requires --expected-sha of the deployed release');
    const health = await fetch('https://youanalyst.com/api/health', {signal:AbortSignal.timeout(30000)}).then(r => r.json());
    if (health.commitSha !== expected) throw new Error('The expected release is not serving traffic');
    for (const [q,id] of [['cwbdt','US:AMD'],['yingweida','US:NVDA'],['600519','XSHG:600519']]) {
      const response = await fetch('https://youanalyst.com/api/tickers/search?'+new URLSearchParams({q,scope:'all'}), {signal:AbortSignal.timeout(30000)});
      const result = await response.json();
      if (response.headers.get('x-company-search-version') !== String(COMPANY_SEARCH_VERSION) || !response.ok || !result.items?.some((item:{id:string}) => item.id===id)) throw new Error('Live unified search probe failed');
    }
  }
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] }).getAccessToken();
  if (!token) throw new Error('Existing Google credentials required');
  const database = `projects/${project}/databases/(default)`;
  const request = async (operation: string, body: unknown) => {
    const response = await fetch(`https://firestore.googleapis.com/v1/${database}/documents:${operation}`, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Firestore ${operation} returned HTTP ${response.status}`);
    return response.json();
  };
  let after: string | undefined, scanned=0, changed=0, removed=0;
  for (;;) {
    const page = await request('runQuery',{structuredQuery:{
      select:{fields:['name','symbol','legalName','names','aliases','searchPrefixes','searchTerms','searchIndexVersion',...RETIRED_COMPANY_SEARCH_FIELDS].map(fieldPath=>({fieldPath}))},
      from:[{collectionId:'companies'}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:200,
      ...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{}),
    }}) as {document?:{name:string;fields:Record<string,Value>;updateTime:string}}[];
    const docs=page.flatMap(row=>row.document?[row.document]:[]);
    if (!docs.length) break;
    let writes:unknown[]=[], bytes=0;
    const commit = async()=>{if(writes.length){await request('commit',{writes});writes=[];bytes=0;}};
    for(const doc of docs){
      scanned++;
      const data=Object.fromEntries(Object.entries(doc.fields??{}).map(([field,value])=>[field,decode(value)]));
      const migration=companySearchMigration(doc.name.split('/').at(-1)!,data,cleanup);
      if(!migration.changed)continue;
      changed++;removed+=migration.removed.length;
      if(apply){
        const write={update:{name:doc.name,fields:Object.fromEntries(Object.entries(migration.patch).map(([field,value])=>[field,encode(value)]))},updateMask:{fieldPaths:[...Object.keys(migration.patch),...migration.removed]},currentDocument:{updateTime:doc.updateTime}};
        const size=Buffer.byteLength(JSON.stringify(write));
        if(bytes+size>4_000_000||writes.length===25)await commit();
        writes.push(write);bytes+=size;
      }
    }
    await commit();after=docs.at(-1)!.name;
    if(apply && scanned%2000===0)console.log(JSON.stringify({progress:scanned,changed,removed}));
  }
  console.log(JSON.stringify({mode:apply?'applied':'preview',phase:cleanup?'cleanup':'prepare',scanned,changed,removed}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Company search migration failed');process.exitCode=1;});
