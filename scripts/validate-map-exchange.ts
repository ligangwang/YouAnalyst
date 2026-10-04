// Public source checks only: no Firestore imports, leases, cursors or event writes.
import {readFileSync} from 'node:fs';
import {createCnEarningsRequester} from '../src/lib/earnings/live-cn';
import {readCnMapDisclosures} from '../src/lib/events/cn-disclosures';

async function main(){
  const inventory=JSON.parse(readFileSync(process.argv[2],'utf8')) as {id:string;market:string}[];
  const now=new Date(),to=new Date(now.getTime()+8*3600000).toISOString().slice(0,10),from=new Date(now.getTime()-7*86400000).toISOString().slice(0,10);
  const transport=createCnEarningsRequester({userAgent:'YouAnalyst/1.0 (map disclosure validation)'});
  for(const company of inventory.filter(row=>row.market==='CN_A')){
    try{
      const rows=await readCnMapDisclosures(company.id,from,to,transport.request,now.toISOString());
      console.log(JSON.stringify({companyId:company.id,status:'ok',documents:rows.length,sample:rows.slice(0,1).map(r=>({title:r.title,date:r.publication_date,url:r.url}))}));
    }catch(error){console.log(JSON.stringify({companyId:company.id,status:'failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;if(Object.keys(transport.blockedHosts()).length)break;}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
