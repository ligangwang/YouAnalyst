import {NEWS_SOURCES} from './sources';

/** Existing SK hynix media pages have the parent title and a numbered child URL.
 * Only exclude a legacy child when its real parent is present in the same source.
 * Future scans use the publisher's explicit Media category instead.
 */
export function newsArticles<T extends {sourceId?:unknown;url?:unknown;title?:unknown}>(records:T[]):T[]{
  const parents=new Set(records.map(row=>`${row.sourceId}\n${row.url}\n${row.title}`));
  return records.filter(row=>{
    const source=NEWS_SOURCES.find(source=>source.id===row.sourceId);
    if(!source?.excludedCategories?.length||typeof row.url!=='string')return true;
    try{
      const parent=new URL(row.url);
      const path=parent.pathname.replace(/-\d+\/$/,'/');
      if(path===parent.pathname)return true;
      parent.pathname=path;
      return !parents.has(`${row.sourceId}\n${parent.href}\n${row.title}`);
    }catch{return true;}
  });
}
