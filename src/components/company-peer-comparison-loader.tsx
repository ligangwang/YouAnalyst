import { loadPeerComparison } from '@/lib/peer-comparison/service';
import { CompanyPeerComparison } from './company-peer-comparison';
export async function CompanyPeerComparisonLoader({companyId,company,aiEligible,pending}:{companyId:string;company?:Record<string,unknown>;aiEligible?:boolean;pending?:ReturnType<typeof loadPeerComparison>}){
 const data=await (pending ?? loadPeerComparison(companyId,{company,aiEligible}));
 return data?.panels.length?<CompanyPeerComparison data={data}/>:null;
}
