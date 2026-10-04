// Read-only source verification. No Firebase imports, initialization or event writes.
import {NEWS_SOURCES} from '../src/lib/intelligence/collectors/sources';
import {fetchNews} from '../src/lib/intelligence/collectors/news';
let next=0;
const results:unknown[]=Array(NEWS_SOURCES.length);
async function main(){await Promise.all(Array.from({length:3},async()=>{
  while(next<NEWS_SOURCES.length){
    const index=next++,source=NEWS_SOURCES[index];
    try{
      const response=await fetchNews(source);
      if(response.status!=='modified')throw new Error('Expected initial source response');
      const hosts=[...new Set(response.page.items.map(item=>new URL(item.url).hostname))];
      results[index]={sourceId:source.id,companyId:source.companyId,status:'ok',items:response.page.items.length,invalid:response.page.invalid,truncated:response.page.truncated,hosts,sample:response.page.items.slice(0,2)};
    }catch(error){results[index]={sourceId:source.id,companyId:source.companyId,status:'failed',error:error instanceof Error?error.message:String(error)};}
    console.log(JSON.stringify(results[index]));
  }
}));}
main().catch(error=>{console.error(error);process.exitCode=1;});
