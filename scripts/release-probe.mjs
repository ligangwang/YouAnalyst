import {createHmac} from 'node:crypto';
/** @returns {Record<string, string>} */
export function releaseProbeHeaders(url, secret = process.env.INTERNAL_API_TOKEN) {
  if(!secret)return {};
  const payload=Buffer.from(JSON.stringify({v:1,aud:new URL(url).origin,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');
  return {'x-ya-release-probe':`${payload}.${signature}`};
}
