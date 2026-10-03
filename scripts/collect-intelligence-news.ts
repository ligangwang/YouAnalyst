import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {NEWS_SOURCES} from '../src/lib/intelligence/collectors/sources';
import {fetchNews} from '../src/lib/intelligence/collectors/news';
import {collectNewsSources} from '../src/lib/intelligence/collectors/collector';
import {firestoreNewsStore} from '../src/lib/intelligence/collectors/store';

async function main(){
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply'))throw new Error('Usage: collect-intelligence-news [--apply]');
  if(!args.includes('--apply')){
    // Dry run never initializes Firestore or writes a checkpoint.
    for(const source of NEWS_SOURCES){try{
      const response=await fetchNews(source);
      console.log(JSON.stringify({sourceId:source.id,companyId:source.companyId,...(response.status==='modified'?{items:response.page.items.length,invalid:response.page.invalid,truncated:response.page.truncated,sample:response.page.items.slice(0,3).map(item=>({title:item.title,url:item.url,publishedAt:item.publishedAt,publishedDate:item.publishedDate}))}:{unchanged:true})}));
    }catch(error){console.log(JSON.stringify({sourceId:source.id,error:error instanceof Error?error.message:'Collector failed'}));process.exitCode=1;}}
    return;
  }
  if(process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED!=='1')throw new Error('News collector is disabled');
  if(!process.env.GCP_PROJECT_ID)throw new Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const results=await collectNewsSources(NEWS_SOURCES,firestoreNewsStore(getFirestore()));
  console.log(JSON.stringify({job:'collect-intelligence-news',results}));
  if(results.some(result=>result.status==='failed'))process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Collector failed');process.exitCode=1;});
