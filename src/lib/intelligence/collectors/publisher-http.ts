import {request} from 'node:https';
import {Readable} from 'node:stream';

/** Standard HTTPS transport for public publisher feeds. No cookies, retries or
 * alternate identities; callers validate every URL and handle blocked responses.
 * Redirects stay manual so a publisher cannot move a request off its allowlist. */
export const publisherFetch:typeof fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.protocol!=='https:'||init.method&&init.method!=='GET'||init.redirect!=='manual')throw new Error('Unsupported publisher request');
  return new Promise<Response>((resolve,reject)=>{
    const outgoing=request(url,{method:'GET',headers:Object.fromEntries(new Headers(init.headers).entries()),signal:init.signal??undefined},incoming=>{
      const headers=new Headers();
      for(const [key,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
      const status=incoming.statusCode??502;
      if([204,205,304].includes(status)){incoming.resume();resolve(new Response(null,{status,headers}));return;}
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>,{status,headers}));
    });
    outgoing.on('error',reject);outgoing.end();
  });
};
