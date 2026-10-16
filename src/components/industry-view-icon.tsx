import type { IndustryView } from '@/lib/knowledge-graph/views';

export function IndustryViewIcon({view}:{view:IndustryView}){
  return <svg style={view==='hierarchy'?{transform:'rotate(-90deg)'}:undefined} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {view==='table'?<><path d="M9 5h12M9 12h12M9 19h12"/><path d="M3 5h1M3 12h1M3 19h1"/></>:(view==='tree'||view==='hierarchy')?<><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/></>:<><path d="m6 7 10-2M6 7l5 11M18 5l-7 13"/><circle cx="5" cy="6" r="3"/><circle cx="19" cy="4" r="3"/><circle cx="11" cy="19" r="3"/></>}
  </svg>;
}
