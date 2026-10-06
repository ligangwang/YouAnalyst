import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {loadNewsSources} from '../src/lib/intelligence/collectors/source-service';
import {fetchNews} from '../src/lib/intelligence/collectors/news';
import {NEWS_HISTORY_START} from '../src/lib/intelligence/collectors/collector';
import {EVENTS_COLLECTION,eventDocumentId} from '../src/lib/events/model';

async function main(){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply'))throw new Error('Usage: repair-coreweave-publication [--apply]');
  if(!process.env.GCP_PROJECT_ID)throw new Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const NEWS_SOURCES=await loadNewsSources(getFirestore());
  const source=NEWS_SOURCES.find(item=>item.id==='coreweave-news')!;
  const response=await fetchNews(source);
  if(response.status!=='modified'||response.page.invalid||response.page.truncated||response.page.items.some(item=>!item.publication_date))throw new Error('Original article dates are not fully verified');
  const items=response.page.items;
  const eligible=items.filter(item=>item.publication_date!>=NEWS_HISTORY_START);
  if(!args.includes('--apply')){console.log(JSON.stringify({mode:'read-only',verified:items.length,eligible:eligible.length,excluded:items.length-eligible.length}));return;}
  const db=getFirestore(),processed_at=new Date().toISOString();
  const result=await db.runTransaction(async tx=>{
    const refs=items.map(item=>db.collection(EVENTS_COLLECTION).doc(eventDocumentId('company_news',item.id)));
    const docs=await tx.getAll(...refs);
    const state=db.collection('collectors').doc(source.id);const cursor=(await tx.get(state)).data();
    if(!cursor||Date.parse(cursor.leaseUntil)>Date.now())throw new Error('Collector state is missing or leased');
    let corrected=0,excluded=0;
    docs.forEach((doc,index)=>{
      if(!doc.exists)return;
      const stored=doc.data()!,item=items[index];
      if(stored.type!=='company_news'||stored.sourceId!==source.id||stored.companyId!==source.companyId||stored.url!==item.url||stored.baseline!==true||typeof stored.collected_at!=='string')throw new Error('Unexpected event identity; no repair committed');
      const version=item.publication_date!>=NEWS_HISTORY_START?1:0;
      tx.update(refs[index],{published_at:null,publication_date:item.publication_date,processed_at,version});
      corrected++;if(!version)excluded++;
    });
    if(corrected!==items.length)throw new Error('Expected every initial imported article; no repair committed');
    tx.update(state,{partial:false,lastError:null,lastSuccessAt:processed_at,validators:response.validators});
    return {corrected,eligible:corrected-excluded,excluded,collectionTimesPreserved:true};
  });
  console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Publication repair failed');process.exitCode=1;});
