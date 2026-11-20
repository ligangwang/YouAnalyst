import { createHmac, timingSafeEqual } from 'node:crypto';

// Release tests may read research without creating a real member account.
// Never transmit the long-lived service secret into browser traces.
export function verifiedReleaseProbe(request: {method:string;headers:Headers;nextUrl:URL}): boolean {
  if (!['GET','HEAD'].includes(request.method) || !process.env.INTERNAL_API_TOKEN) return false;
  const token=request.headers.get('x-ya-release-probe') ?? '';
  if(token.length>2048)return false;
  const [payload,signature,...extra]=token.split('.');
  if(!payload||!signature||extra.length)return false;
  const expected=createHmac('sha256',process.env.INTERNAL_API_TOKEN).update(payload).digest('base64url');
  const a=Buffer.from(signature), b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return false;
  try {
    const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
    const now=Math.floor(Date.now()/1000);
    return claims.v===1 && claims.aud===request.nextUrl.origin && Number.isInteger(claims.exp) && claims.exp>now && claims.exp<=now+600;
  } catch { return false; }
}
