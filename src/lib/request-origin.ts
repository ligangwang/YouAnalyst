/** Accept the configured public origin behind a proxy, never forwarded host headers. */
export function hasTrustedRequestOrigin(request:Request,siteUrl=process.env.NEXT_PUBLIC_SITE_URL):boolean{
  if(request.headers.get('sec-fetch-site')==='cross-site')return false;
  const origin=request.headers.get('origin');
  // Bearer-authenticated non-browser API clients do not send Origin.
  if(!origin)return true;
  try{
    const parsed=new URL(origin);
    if(!['https:','http:'].includes(parsed.protocol)||parsed.origin!==origin)return false;
    const incoming=new URL(request.url).origin;
    const publicOrigin=siteUrl?new URL(siteUrl).origin:incoming;
    return origin===incoming||origin===publicOrigin;
  }catch{return false;}
}
