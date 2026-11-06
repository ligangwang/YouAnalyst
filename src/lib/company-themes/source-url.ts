/** Canonicalize harmless presentation differences, retaining the underlying official document. */
export function officialSourceUrl(value:string){
  if(typeof value!=='string'||value.length>2048)throw Error('Invalid official source URL');
  let url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid official source URL');
  if(['sec.gov','www.sec.gov'].includes(url.hostname)&&/^\/ix(?:viewer)?(?:\/|$)/i.test(url.pathname)){
    const document=url.searchParams.get('doc');
    if(document){const target=new URL(document,'https://www.sec.gov');if(!['sec.gov','www.sec.gov'].includes(target.hostname)||!/^\/Archives\/edgar\/data\//i.test(target.pathname)||target.protocol!=='https:'||target.username||target.password)throw Error('Invalid official source URL');url=target;}
  }
  if(url.hostname==='sec.gov')url.hostname='www.sec.gov';
  url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['gclid','fbclid'].includes(key))url.searchParams.delete(key);
  url.searchParams.sort();return url.href;
}

export function secSourceMatchesIssuer(value:string,cik:unknown){
  const id=String(cik??'');if(!/^\d{1,10}$/.test(id)||Number(id)<=0)return false;
  try{
    const url=new URL(officialSourceUrl(value));
    if(url.hostname!=='sec.gov'&&!url.hostname.endsWith('.sec.gov'))return false;
    const archive=url.pathname.match(/\/edgar\/data\/(\d+)\//i),profile=url.pathname.match(/\/CIK(\d+)\.json$/i);
    return Number(archive?.[1]??profile?.[1]??url.searchParams.get('CIK')??url.searchParams.get('cik')??0)===Number(id);
  }catch{return false;}
}
