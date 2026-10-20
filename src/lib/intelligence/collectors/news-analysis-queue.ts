import {NEWS_ANALYSIS_VERSION} from './news-analysis';

export function newsAnalysisQueueFields(row:Record<string,unknown>){
  const state=row.newsAnalysis as {version?:number;status?:string}|undefined;
  const terminal=state?.version===NEWS_ANALYSIS_VERSION&&['complete','review_required'].includes(String(state.status));
  return {newsAnalysisNextCheckAtMs:row.type==='company_news'&&row.sourceType==='company_ir'&&!terminal?0:Number.MAX_SAFE_INTEGER};
}
