import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {NewsSource} from '../intelligence/collectors/sources';
import { approvedNewsUrl } from '../intelligence/collectors/news';
import { publisherFetch } from '../intelligence/collectors/publisher-http';
import { htmlToEarningsText } from '../earnings/document';
import type { CalendarSource } from './model';

const MAX_BYTES = 2_000_000;
export function approvedCalendarUrl(url: string, source: CalendarSource, sources:readonly NewsSource[]) {
  if (source.sourceType === 'exchange') return /^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(url);
  const config = sources.find(s=>s.id===source.sourceId && s.companyId===source.companyIds[0]);
  return Boolean(config && approvedNewsUrl(url,config,true));
}
export function calendarArticleText(html: string) {
  // ASP.NET IR pages wrap the entire article in a form, so keep its contents.
  const clean = html.replace(/<(header|footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const body = clean.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? clean;
  return htmlToEarningsText(body);
}
export async function fetchCalendarArticle(source: CalendarSource, request:typeof fetch|undefined, sources:readonly NewsSource[]) {
  const config = sources.find(s=>s.id===source.sourceId && s.companyId===source.companyIds[0]);
  const fetcher = request ?? (config?.transport==='https'?publisherFetch:fetch);
  let url = source.url;
  for (let redirects=0;redirects<=3;redirects++) {
    if (!approvedCalendarUrl(url,source,sources)) throw new Error('Calendar source host is not approved');
    const response = await fetcher(url,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'YouAnalyst/1.0 (announced earnings calendar)',Accept:'text/html,application/pdf'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const target = response.headers.get('location'); await response.body?.cancel();
      if (!target) throw new Error('Article redirect has no location'); url=new URL(target,url).href; continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Calendar article returned HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length'))>MAX_BYTES) { await response.body.cancel(); throw new Error('Calendar article exceeds size limit'); }
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    try { while(true) { const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_BYTES)throw new Error('Calendar article exceeds size limit');chunks.push(chunk.value); } }
    finally { await reader.cancel(); }
    const buffer=Buffer.concat(chunks); let text: string;
    if (buffer.subarray(0,5).toString()==='%PDF-') {
      const directory=await mkdtemp(join(tmpdir(),'youanalyst-calendar-'));
      try { const file=join(directory,'article.pdf');await writeFile(file,buffer);text=(await promisify(execFile)('pdftotext',['-layout',file,'-'],{timeout:20_000,maxBuffer:MAX_BYTES})).stdout; }
      finally { await rm(directory,{recursive:true,force:true}); }
    } else {
      if (/\.pdf$/i.test(url) || !/text\/html|application\/xhtml/i.test(response.headers.get('content-type')??'')) throw new Error('Unsupported calendar article format');
      text=calendarArticleText(buffer.toString('utf8'));
    }
    text=text.normalize('NFKC').replace(/\r/g,'').trim();
    if (text.length<100 || text.length>60_000 || /captcha|access denied|request (?:has been )?blocked/i.test(text.slice(0,500))) throw new Error('Calendar article text unavailable or exceeds extraction limit');
    return text;
  }
  throw new Error('Too many calendar article redirects');
}
