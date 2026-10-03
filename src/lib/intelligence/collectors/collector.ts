import {randomUUID} from 'node:crypto';
import {fetchNews,NewsFetchError,type NewsItem,type NewsResponse,type NewsValidators} from './news';
import type {NewsSource} from './sources';
import type {StoredEvent} from '../../events/model';

/** Initial archive starts in the launch year; keep publication and arrival time separate. */
export const NEWS_HISTORY_START='2026-01-01';

export type NewsCursor={version:1;sourceId:string;baselineAt:string|null;lastSuccessAt:string|null;nextPollAt:string;failures:number;validators:NewsValidators;itemIds:string[];leaseId:string;leaseUntil:string;lastError:string|null;partial:boolean};
export type CollectedNews=NewsItem&StoredEvent&{type:'company_news';sourceType:'company_ir'};
export interface NewsStore{
  acquire(source:NewsSource,at:Date,leaseId:string):Promise<NewsCursor|null>;
  commit(source:NewsSource,cursor:NewsCursor,response:NewsResponse,at:Date):Promise<{created:number;baseline:boolean}>;
  fail(source:NewsSource,cursor:NewsCursor,error:string,retryAt:Date):Promise<void>;
}
export async function collectNewsSources(sources:readonly NewsSource[],store:NewsStore,read:typeof fetchNews=fetchNews,clock=()=>new Date()){
  const results:{sourceId:string;status:'ok'|'skipped'|'failed';created?:number;baseline?:boolean;error?:string}[]=[];
  // Publisher requests are sequential and each source has its own durable lease.
  for(const source of sources){
    const cursor=await store.acquire(source,clock(),randomUUID());
    if(!cursor){results.push({sourceId:source.id,status:'skipped'});continue;}
    try{
      const response=await read(source,cursor.validators);
      if(response.status==='unchanged'&&!cursor.baselineAt)throw new Error('Uninitialized collector received HTTP 304');
      const result=await store.commit(source,cursor,response,clock());
      results.push({sourceId:source.id,status:'ok',...result});
    }catch(error){
      const message=error instanceof Error?error.message:'Collector failed';
      const delay=Math.max(source.pollMs*Math.min(64,2**Math.min(6,cursor.failures)),error instanceof NewsFetchError?error.retryAfterMs:0);
      await store.fail(source,cursor,message,new Date(clock().getTime()+delay));
      results.push({sourceId:source.id,status:'failed',error:message});
    }
  }
  return results;
}
