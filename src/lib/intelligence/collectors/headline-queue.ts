import {translatedSummary} from '../../knowledge-graph/summary-translations';
export function headlineTargetLocale(title:string):'en'|'zh-CN'{return /[\u4e00-\u9fff]/.test(title)?'en':'zh-CN';}
export function needsHeadlineTranslation(record:Record<string,unknown>){
  if(!(record.type==='company_news'||record.type==='company_disclosure'&&record.sourceType==='exchange')||typeof record.title!=='string'||!record.title.trim()||record.title.length>1000)return false;
  if(translatedSummary(record.title,(record.titleTranslations as Record<string,unknown>|undefined)?.[headlineTargetLocale(record.title)]))return false;
  const state=record.titleTranslationState as {source?:string}|undefined;
  // A persisted request intent also blocks repeats after a crash or ambiguous timeout.
  return !state||state.source!==record.title;
}
export function headlineQueueFields(record:Record<string,unknown>){
  const date=String(record.published_at??record.publication_date??'').slice(0,10);
  return {headlineTranslationPending:needsHeadlineTranslation(record),headlineTranslationDate:date};
}
