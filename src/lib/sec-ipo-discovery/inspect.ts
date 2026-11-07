import {parseDailyIndex,confirmedMappings,resolveProspectuses,confirmsIpoCover} from './evidence';
import type {IpoSource} from './source';

/** Provider-level rollout check; does not create discovery or onboarding records. */
export async function inspectIpoDiscovery(source:IpoSource,now=new Date()){
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const result:{indexes:number;filings:number;checked:number;confirmed:{cik:string;symbol:string;exchangeMic:string;sourceUrl:string}[]}={indexes:0,filings:0,checked:0,confirmed:[]};
  for(let n=1;n<=3;n++){
    const day=new Date(Date.parse(local)-n*86400000).toISOString().slice(0,10),text=await source.daily(day);if(text===null)continue;
    result.indexes++;const rows=parseDailyIndex(text,day);result.filings+=rows.length;
    for(const cik of new Set(rows.filter(row=>['424B4','424B1'].includes(row.form)).map(row=>row.cik))){
      if(result.checked>=5)return result;result.checked++;
      const submission=await source.submission(cik),filings=resolveProspectuses(submission,rows.filter(row=>row.cik===cik),cik),listings=confirmedMappings(await source.mapping(),submission,cik);
      for(const filing of filings){const html=await source.cover(filing.sourceUrl);for(const listing of listings)if(confirmsIpoCover(html,listing))result.confirmed.push({cik,symbol:listing.symbol,exchangeMic:listing.exchangeMic,sourceUrl:filing.sourceUrl});}
    }
  }
  return result;
}
