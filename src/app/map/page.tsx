import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseLocale } from '@/lib/locale';
import { localizedPath } from '@/lib/i18n/urls';

// Compatibility only: the homepage now owns every industry view.
export default async function MapPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  const locale=parseLocale((await headers()).get('x-ya-language'))??'en';
  if(params.view==='filings')redirect(localizedPath('/feed',locale));
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)){
    if(Array.isArray(value))for(const item of value)query.append(key,item);
    else if(typeof value==='string')query.set(key,value);
  }
  redirect(`${localizedPath('/',locale)}${query.size?'?'+query:''}`);
}
