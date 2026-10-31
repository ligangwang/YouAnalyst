import type {ResolvedCompany} from './company-research-service';

/** Start only reads whose demand is already established by the route identity.
 * The completed identity remains authoritative if visibility changes. */
export async function loadCompanySection<T>(
  id:string,
  resolved:ResolvedCompany|undefined,
  research:Promise<{inMap:boolean;hasCompanyContent?:boolean}>,
  read:()=>Promise<T>,
  empty:T,
):Promise<T>{
  const data=resolved?.id===id?resolved.data:undefined;
  const membership=data?.inGraph as {status?:unknown}|undefined;
  const confirmed=data?.isDeleted!==true && ['PUBLISHED','DIRECTORY'].includes(String(data?.status))
    && typeof data?.name==='string' && Boolean(data.name) && membership?.status==='PUBLISHED';
  if(confirmed){
    const [company,section]=await Promise.all([research,read()]);
    return (company.hasCompanyContent??company.inMap)?section:empty;
  }
  const company=await research;
  return (company.hasCompanyContent??company.inMap)?read():empty;
}
