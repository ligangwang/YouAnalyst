// Local-only, read-only review proxy. Start the built Next app on port 3000 first.
// Public GET payloads populate the existing app without database credentials.
import {createServer} from 'node:http';import net from 'node:net';import fs from 'node:fs/promises';
const allowed=['/api/compare','/api/calendar','/api/knowledge-graph','/api/industry-graph','/api/intelligence','/api/tickers/search','/api/features'];
const cache=new Map();const evidenceRoot=new URL('../../output/design-refresh/',import.meta.url);
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://127.0.0.1:3002');
 if(u.pathname==='/__design'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(await fs.readFile(new URL('index.html',evidenceRoot)));}
 const shot=/^\/__design\/screens\/(baseline|preview)\/(explore|compare|companies|calendar|about|watchlist)-(desktop|laptop|mobile)-(dark|light)\.png$/.exec(u.pathname);
 if(shot){res.writeHead(200,{'content-type':'image/png'});return res.end(await fs.readFile(new URL(shot[1]+'/'+shot[2]+'-'+shot[3]+'-'+shot[4]+'.png',evidenceRoot)));}

 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end('Read-only design preview');}
 const publicApi=allowed.some(p=>u.pathname===p||u.pathname.startsWith(p+'/'));
 const target=(publicApi?'https://youanalyst.com':'http://127.0.0.1:3000')+u.pathname+u.search;
 let value=publicApi?cache.get(target):null;
 if(!value){const r=await fetch(target,{headers:publicApi?{}:{...req.headers,host:'127.0.0.1:3000'},signal:AbortSignal.timeout(90000)});value={status:r.status,type:r.headers.get('content-type'),body:Buffer.from(await r.arrayBuffer())};if(publicApi&&r.ok){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(target,value);}}
 res.writeHead(value.status,{'content-type':value.type||'application/octet-stream','cache-control':'no-store'});res.end(value.body);
}catch(e){res.writeHead(502);res.end(String(e));}});server.on('upgrade',(req,socket,head)=>{const upstream=net.connect(3000,'127.0.0.1',()=>{upstream.write(req.method+' '+req.url+' HTTP/1.1\r\n'+Object.entries({...req.headers,host:'127.0.0.1:3000'}).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());});server.listen(3002,'127.0.0.1',()=>console.log('Read-only local design preview: http://127.0.0.1:3002/en/compare'));

