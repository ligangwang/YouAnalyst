import { loadPeerComparison } from '@/lib/peer-comparison/service';
import { CompanyPeerComparison } from './company-peer-comparison';
export async function CompanyPeerComparisonLoader({companyId}:{companyId:string}){
 const data=await loadPeerComparison(companyId);
 return data?.panels.length?<CompanyPeerComparison data={data}/>:null;
}
