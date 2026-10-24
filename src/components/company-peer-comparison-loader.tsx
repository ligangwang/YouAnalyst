import { loadPeerComparison } from '@/lib/peer-comparison/service';
import { CompanyPeerComparison } from './company-peer-comparison';
export async function CompanyPeerComparisonLoader({companyId,company,aiEligible}:{companyId:string;company?:Record<string,unknown>;aiEligible?:boolean}){
 const data=await loadPeerComparison(companyId,{company,aiEligible});
 return data?.panels.length?<CompanyPeerComparison data={data}/>:null;
}
