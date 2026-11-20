import {createHmac} from 'node:crypto';
/** @returns {Record<string, string>} */
export function releaseProbeHeaders(url) {
  if(!process.env.INTERNAL_API_TOKEN)return {};
  const payload=Buffer.from(JSON.stringify({v:1,aud:new URL(url).origin,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const signature=createHmac('sha256',process.env.INTERNAL_API_TOKEN).update(payload).digest('base64url');
  return {'x-ya-release-probe':`${payload}.${signature}`};
}
