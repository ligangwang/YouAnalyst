import { build } from 'esbuild';
import path from 'node:path';
import { easternDay } from '../../../src/lib/calendar/display';
import type { CalendarItem } from '../../../src/lib/calendar/model';

export const fixtureDay=easternDay(new Date().toISOString());
export const calendarFixtures:CalendarItem[]=Array.from({length:8},(_,index)=>({
  version:1,id:`scheduled_${index}`,type:'scheduled_event',companyId:index===7?'XSHG:600000':`US:${index===0?'NVDA':index===1?'RKLB':`TEST${index}`}`,companyIds:[],
  companyName:index===0?'NVIDIA':index===1?'Rocket Lab':`Example company ${index}`,ticker:index===0?'NVDA':index===1?'RKLB':index===7?'600000':`TEST${index}`,
  themes:index===0?['ai','robotics']:index===1?['space']:['ai'],sector:{en:'AI compute',zh:'AI 算力',color:index===1?'#ff9eae':'#65d9ff'},
  sourceType:'company_ir',sourceId:'fixture',title:'Announced earnings call',summary:'Illustrative test announcement',url:'https://example.com/earnings',
  published_at:null,publication_date:fixtureDay,collected_at:new Date().toISOString(),processed_at:new Date().toISOString(),baseline:false,
  eventKind:index===1?'earnings_release':'earnings_call',fiscalPeriod:'FY2026-Q3',scheduled_date:fixtureDay,
  scheduled_at:index===1?null:`${fixtureDay}T${String(17+Math.floor(index/2)).padStart(2,'0')}:00:00Z`,local_time:null,source_timezone:index===1?null:'America/New_York',
  timezone_text:null,time_precision:index===1?'date':'exact',timeSlot:'unspecified',status:index===2?'cancelled':'scheduled',confirmation:'official',
  sourceEventIds:['fixture'],dateEvidence:'',timeEvidence:'',periodEvidence:'',announcement_date:fixtureDay,extractionModel:'gpt-6-luna',contentHash:'fixture',
}));
calendarFixtures.push(
  {...calendarFixtures[0],id:'scheduled_nvda_release',eventKind:'earnings_release',scheduled_at:null,time_precision:'date',timeSlot:'after_market'},
  {...calendarFixtures[2],id:'scheduled_test2_release',eventKind:'earnings_release',scheduled_at:null,time_precision:'date',timeSlot:'before_market',status:'rescheduled',url:'https://example.com/results'},
);

export async function calendarFixtureHtml() {
  const mock=path.resolve('tests/conversion/fixtures/mocks.tsx');
  const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {EarningsCalendar} from './src/components/earnings-calendar';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    const locale=new URLSearchParams(location.search).get('lang')==='zh-CN'?'zh-CN':'en';
    createRoot(document.getElementById('root')).render(<LocaleProvider locale={locale}><EarningsCalendar/></LocaleProvider>);`,resolveDir:process.cwd(),loader:'tsx'},
    bundle:true,write:false,outfile:'calendar.js',platform:'browser',define:{'process.env':'{}'},
    alias:{'next/link':mock,'next/navigation':mock,'@/components/providers/auth-provider':mock},
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#07131e;font-family:Arial,sans-serif}h1,h2,h3,p{margin:0}button{border:0;background:transparent}a{text-decoration:none}button,input,select{font:inherit}${result.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${result.outputFiles.find(file=>file.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
}
