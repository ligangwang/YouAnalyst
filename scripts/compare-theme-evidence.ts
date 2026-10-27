/** Bounded, non-enrolling real-issuer comparison. It reads existing profiles and
 * catalog; the official transports use the existing shared provider gates. */
import {getAdminFirestore} from '../src/lib/firebase/admin';
import {getOpenAiApiKey} from '../src/lib/openai-runtime';
import {loadThemeCatalog} from '../src/lib/company-themes/catalog';
import {loadBusinessEvidence} from '../src/lib/company-themes/business-evidence';
import {loadOfficialAnnual} from '../src/lib/company-themes/official-annual-loader';
import {officialAnnualTransport} from '../src/lib/company-themes/official-annual-transport';
import {classifyOfficialThemes,type ThemeClassification} from '../src/lib/company-themes/classification';
import type {ThemedCompany} from '../src/lib/company-themes/model';

const ids=['US:IBM','XSHG:688981'] as const;
const normalized=(result:ThemeClassification)=>result.assignments.map(item=>({theme:item.theme,primarySector:item.primarySector,secondaryRoles:[...(item.secondaryRoles??[])].sort(),aiStageIds:[...(item.aiStageIds??[])].sort()})).sort((a,b)=>a.theme.localeCompare(b.theme));
async function main(){
  const db=getAdminFirestore(),catalog=await loadThemeCatalog(),prepared=[];
  for(const id of ids){
    const doc=await db.collection('companies').doc(id).get();if(!doc.exists)throw Error(`Missing company ${id}`);
    const company={...doc.data(),id} as ThemedCompany;let decision='unknown';
    const annual=await loadOfficialAnnual(company,officialAnnualTransport(db),Date.now(),value=>{decision=value;});
    if(!annual){console.log(JSON.stringify({companyId:id,status:'not_comparable',decision}));process.exitCode=1;continue;}
    prepared.push({company,annual});
  }
  // Don't make paid model calls if either market lacks usable complete evidence.
  if(prepared.length!==ids.length)return;
  const key=getOpenAiApiKey();let matched=true;
  for(const {company,annual} of prepared){
    let searches=0;
    const observedFetch:typeof fetch=async(input,init)=>{const body=JSON.parse(String(init?.body??'{}'));if(body.tools?.some((tool:{type?:string})=>tool.type==='web_search'))searches++;return fetch(input,init);};
    const evidenceOnly=await classifyOfficialThemes(company,catalog,{key,verifiedAnnual:annual,fetcher:observedFetch});
    const usedSearch=searches>0;
    const current=await classifyOfficialThemes(company,catalog,{key,evidence:await loadBusinessEvidence(db,company),fetcher:observedFetch});
    const left=normalized(evidenceOnly),right=normalized(current),same=JSON.stringify(left)===JSON.stringify(right);
    console.log(JSON.stringify({companyId:company.id,status:usedSearch?'inconclusive_fallback':same?'matched':'different',evidenceOnly:left,current:right,searchRequests:searches}));
    if(usedSearch||!same)matched=false;
  }
  if(!matched)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({status:'comparison_error',kind:error instanceof Error?error.name:'unknown'}));process.exitCode=1;});
