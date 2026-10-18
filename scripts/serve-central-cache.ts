import { loadIncrementalSitemap } from '../src/lib/central-cache/sitemap';
import { companyBucketPrefix } from '../src/lib/ui/i18n/company-sitemaps';
import { createServer } from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from '../src/lib/firebase/firestore';
import { CentralCache, collections, type Collection } from '../src/lib/central-cache/store';
import { firestoreSource } from '../src/lib/central-cache/source';
import { encode } from '../src/lib/central-cache/codec';
import { readCacheState } from '../src/lib/change-cache';

const project=process.env.GCP_PROJECT_ID;if(!project)throw Error('GCP_PROJECT_ID required');
initializeApp({credential:applicationDefault(),projectId:project});const db=getFirestore();
const cache=new CentralCache(firestoreSource(db));
// Production authentication is enforced by Cloud Run IAM (no allUsers invoker).
// Local listener is loopback-only. The service exposes reads, never source writes.
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  try {
    if(req.method==='GET' && req.url==='/health'){await cache.warm();res.end(JSON.stringify(cache.stats()));return;}
    if(req.method!=='POST' || !['/read','/change','/warm','/sitemap'].includes(req.url??'')){res.statusCode=404;res.end('{}');return;}
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536){res.statusCode=413;res.end('{}');return;}}
    if(req.url==='/warm'){await cache.warm();res.end(JSON.stringify(cache.stats()));return;}
    const input=JSON.parse(body);
    if(req.url==='/sitemap'){
      const prefix=typeof input.bucket==='string'?companyBucketPrefix(input.bucket):null;
      if(!prefix){res.statusCode=400;res.end('{}');return;}
      res.end(JSON.stringify(encode(await loadIncrementalSitemap(db,prefix))));return;
    }
    if(!collections.includes(input.collection) || (input.ids!==undefined && (!Array.isArray(input.ids)||input.ids.length>1000||input.ids.some((id:unknown)=>typeof id!=='string'||!id||id.includes('/'))))){res.statusCode=400;res.end('{}');return;}
    const collection=input.collection as Collection;
    if(input.exchangeRegion!==undefined && (req.url!=='/read' || collection!=='companies' || input.ids!==undefined || !['US','CN'].includes(input.exchangeRegion))){res.statusCode=400;res.end('{}');return;}
    const state=await readCacheState(db);
    if(!state.enabled)throw Error('Change tracking disabled');
    await cache.warm();
    if(collection==='company_fundamentals')await cache.refresh('companies',state.versions?.companies??'initial');
    await cache.refresh(collection,state.versions?.[collection]??'initial',req.url==='/change'?input.ids??[]:[]);
    if(req.url==='/read' && input.ids && collection!=='company_relationships' && input.ids.some((id:string)=>!cache.read('companies',[id]).length))throw Error('ID outside covered cache');
    const rows=collection==='company_relationships' && input.query?cache.relationships(input.query):collection==='companies' && input.exchangeRegion?cache.companies(input.exchangeRegion):cache.read(collection,input.ids);
    res.end(JSON.stringify(req.url==='/read'?encode(input.projection==='marketCap'?rows.map(row=>({id:row.id,data:{marketCap:row.data.marketCap}})):rows):cache.stats()));
  }catch(error){console.error('central_cache_request_failed',error);res.statusCode=503;res.end('{"error":"Cache unavailable"}');}
});
server.listen(Number(process.env.PORT??8088),process.env.K_SERVICE?'0.0.0.0':'127.0.0.1');
