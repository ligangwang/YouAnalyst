/** A conservative index result: any later disclosure forces search fallback.
 * The index itself must be fetched from the official issuer-specific endpoint. */
export type IndexedAnnual={documentId:string;filedAt:string;url:string;laterDisclosures:boolean};
export type IndexedDisclosure={documentId:string;filedAt:string;url:string;title:string};
const day=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
export function cnDisclosureDay(time:number):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const value=(key:string)=>parts.find(part=>part.type===key)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Turn an already validated CNINFO index into an exact, bounded list of all
 * later documents. A truncated list must never be treated as complete. */
export function cnLaterDisclosures(code:string,orgId:string,pages:readonly unknown[],limit=8):IndexedDisclosure[]|null {
  const annual=cnAnnualIndex(code,orgId,pages);
  if(!annual || !Number.isSafeInteger(limit) || limit<0)return null;
  const result:IndexedDisclosure[]=[];
  for(const page of pages as {announcements:Record<string,unknown>[]}[]){
    for(const row of page.announcements){
      const documentId=String(row.announcementId), path=String(row.adjunctUrl),filedAt=path.split('/')[1];
      if(documentId!==annual.documentId && filedAt>=annual.filedAt){
        result.push({documentId,filedAt,url:`https://static.cninfo.com.cn/${path}`,title:String(row.announcementTitle).replace(/<[^>]*>/g,'')});
        if(result.length>limit)return null;
      }
    }
  }
  return result.sort((a,b)=>a.filedAt.localeCompare(b.filedAt)||a.documentId.localeCompare(b.documentId));
}

export function secAnnualIndex(cik:string,payload:unknown):IndexedAnnual|null {
  if(!/^\d{1,10}$/.test(cik)||Number(cik)===0||!payload||typeof payload!=='object')return null;
  const data=payload as {cik?:unknown;filings?:{recent?:Record<string,unknown>}};
  if(Number(data.cik)!==Number(cik))return null;
  const recent=data.filings?.recent;
  if(!recent)return null;
  const {form,accessionNumber,filingDate,primaryDocument}=recent;
  if(!Array.isArray(form)||!Array.isArray(accessionNumber)||!Array.isArray(filingDate)||!Array.isArray(primaryDocument)
    || !form.length || [accessionNumber,filingDate,primaryDocument].some(a=>a.length!==form.length))return null;
  const rows=form.map((f,i)=>({form:f,id:accessionNumber[i],date:filingDate[i],file:primaryDocument[i]}));
  if(rows.some(r=>typeof r.form!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(r.id)||!day(r.date)||typeof r.file!=='string'||!/^[\w.-]+$/.test(r.file)) || new Set(rows.map(r=>r.id)).size!==rows.length)return null;
  const annual=rows.filter(r=>r.form==='10-K').sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))[0];
  if(!annual)return null;
  return {documentId:annual.id,filedAt:annual.date,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${annual.id.replaceAll('-','')}/${annual.file}`,laterDisclosures:rows.some(r=>r.id!==annual.id&&r.date>=annual.date)};
}

/** Return every filing after the selected annual filing, including filings on
 * the same day. Refuse a partial result when the bound would be exceeded. */
export function secLaterDisclosures(cik:string,payload:unknown,limit=8):IndexedDisclosure[]|null {
  const annual=secAnnualIndex(cik,payload);
  if(!annual||!Number.isSafeInteger(limit)||limit<0)return null;
  const recent=(payload as {filings:{recent:{form:string[];accessionNumber:string[];filingDate:string[];primaryDocument:string[]}}}).filings.recent;
  const result:IndexedDisclosure[]=[];
  for(let i=0;i<recent.form.length;i++){
    const documentId=recent.accessionNumber[i],filedAt=recent.filingDate[i];
    if(documentId!==annual.documentId&&filedAt>=annual.filedAt){
      result.push({documentId,filedAt,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${documentId.replaceAll('-','')}/${recent.primaryDocument[i]}`,title:recent.form[i]});
      if(result.length>limit)return null;
    }
  }
  return result.sort((a,b)=>a.filedAt.localeCompare(b.filedAt)||a.documentId.localeCompare(b.documentId));
}

export function cnAnnualIndex(code:string,orgId:string,pages:readonly unknown[]):IndexedAnnual|null {
  if(!/^\d{6}$/.test(code)||!/^\w{1,40}$/.test(orgId)||!pages.length)return null;
  const seen=new Set<string>(), rows:{id:string;title:string;url:string;date:string}[]=[];let total:number|undefined;
  for(let p=0;p<pages.length;p++){
    const page=pages[p] as {announcements?:unknown;hasMore?:unknown;totalAnnouncement?:unknown};
    if(!page||!Array.isArray(page.announcements)||typeof page.hasMore!=='boolean'||page.hasMore!==(p<pages.length-1)
      ||!Number.isSafeInteger(page.totalAnnouncement)||Number(page.totalAnnouncement)<0||(total!==undefined&&page.totalAnnouncement!==total))return null;
    total=Number(page.totalAnnouncement);
    for(const value of page.announcements){
      if(!value||typeof value!=='object')return null;
      const r=value as Record<string,unknown>,id=String(r.announcementId??''),path=r.adjunctUrl,title=r.announcementTitle;
      if(r.secCode!==code||r.orgId!==orgId||!/^\d+$/.test(id)||seen.has(id)||typeof path!=='string'||!/^finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(path)||typeof title!=='string')return null;
      const date=path.split('/')[1];if(!day(date))return null;
      seen.add(id);rows.push({id,title:title.replace(/<[^>]*>/g,''),url:`https://static.cninfo.com.cn/${path}`,date});
    }
  }
  if(seen.size!==total)return null;
  const annual=rows.filter(r=>/\d{4}\s*年\s*年度报告(?:[（(](?:修订|更正|更新)(?:版|后)?[）)])?\s*$/.test(r.title)&&!/半年度|季度|摘要|英文|取消|撤销|提示|预约/.test(r.title)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))[0];
  if(!annual)return null;
  return {documentId:annual.id,filedAt:annual.date,url:annual.url,laterDisclosures:rows.some(r=>r.id!==annual.id&&r.date>=annual.date)};
}
