"use client";

import {useThemeCatalog} from './use-theme-catalog';
import { useEffect, useRef, useState } from 'react';
import { parseCompanyTheme, type CompanyThemeId } from '@/lib/company-themes/model';
import type {IntelligencePayload,PresentationIntelligenceSnapshot as IntelligenceSnapshot} from '@/lib/ui/intelligence-transport';
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';

const clearedThemeSelection = { company: '', feedCompany: '', relationship: '', event: '', q: '', page: '' };
const feedCompany = (params: URLSearchParams) => params.get('feedCompany')?.toUpperCase()==='ALL'?'':(params.get('feedCompany') || (!params.get('event') && !params.get('relationship') ? params.get('company') : '') || '').toUpperCase();
const feedScope = (company:string,query:string,region:string) => JSON.stringify([company,company?'':query.normalize('NFKC').trim(),company?'':region==='US'||region==='CN_A'?region:'']);

/** Keeps the displayed theme usable until a validated replacement is ready. */
export function useIntelligenceSnapshot(initialSnapshot?: IntelligenceSnapshot, initialTheme = 'ai') {
  const {themes}=useThemeCatalog();
  const defaultTheme=themes[0]??initialTheme;
  const theme = parseCompanyTheme(useIndustryBrowseParam('theme', defaultTheme, initialTheme));
  const explicitCompany = useIndustryBrowseParam('feedCompany');
  const selectedCompany = useIndustryBrowseParam('company');
  const selectedEvent = useIndustryBrowseParam('event');
  const selectedRelationship = useIndustryBrowseParam('relationship');
  const searchQuery = useIndustryBrowseParam('q');
  const searchRegion = useIndustryBrowseParam('region');
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot | null>(initialSnapshot ?? null);
  const bootstrapRequired = useRef(!initialSnapshot);
  const serverFeedAvailable=useRef(Boolean(initialSnapshot&&!initialSnapshot.eventsPending));
  const themeSnapshots = useRef(new Map<CompanyThemeId, IntelligenceSnapshot>(
    initialSnapshot ? [[parseCompanyTheme(initialSnapshot.theme), initialSnapshot]] : [],
  ));
  const graphs=useRef(new Map<CompanyThemeId,Pick<IntelligenceSnapshot,'graph'|'graphVersion'|'generatedAt'>>(initialSnapshot?[[parseCompanyTheme(initialSnapshot.theme),initialSnapshot]]:[]));
  const themeIntent = useRef<CompanyThemeId | null>(null);
  const snapshotScope = useRef(feedScope('','',''));
  const company = themeIntent.current === theme || explicitCompany.toUpperCase()==='ALL' ? '' : (explicitCompany || (!selectedEvent && !selectedRelationship ? selectedCompany : '')).toUpperCase();
  const query = themeIntent.current === theme || company ? '' : searchQuery.normalize('NFKC').trim();
  const region = themeIntent.current === theme || company ? '' : searchRegion==='US'||searchRegion==='CN_A'?searchRegion:'';
  const scope = feedScope(company,query,region);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const responses=useRef(new Map<string,{etag:string;data:IntelligenceSnapshot}>());
  const previousDay = useRef<string | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [fullEvents,setFullEvents]=useState(false);
  const loadFullEvents=()=>{if(!fullEvents&&(!snapshot||snapshot.eventsPending||snapshot.eventsLimited))setFullEvents(true);};

  useEffect(() => {
    let disposed = false, inFlight = false;
    let controller: AbortController | null = null;
    const universeController = new AbortController();
    const isCurrentTheme = () => {
      const params = new URLSearchParams(window.location.search);
      return !disposed && parseCompanyTheme(params.get('theme')||defaultTheme) === theme && (themeIntent.current === theme || feedScope(feedCompany(params),params.get('q')??'',params.get('region')??'') === scope);
    };
    // Start the directory independently. A late bootstrap must never replace
    // a complete feed or a response belonging to another theme/company.
    let universeRequest:Promise<IntelligenceSnapshot>|undefined;
    const universe=()=>universeRequest??=(async()=>{
      const response=await fetch(`/api/intelligence?theme=${theme}&section=universe`,{cache:'no-store',signal:AbortSignal.any([universeController.signal,AbortSignal.timeout(15_000)])});
      if(!response.ok)throw Error('Graph unavailable');
      const data:IntelligenceSnapshot=await response.json();
      if((data.theme??'ai')!==theme||!data.graphVersion||!Array.isArray(data.graph?.nodes)||!Array.isArray(data.events)||!data.session?.startAt)throw Error('Invalid graph');
      const previous=graphs.current.get(theme);
      if(!previous||Date.parse(previous.generatedAt)<=Date.parse(data.generatedAt))graphs.current.set(theme,data);
      return data;
    })().catch(error=>{universeRequest=undefined;throw error;});
    if (bootstrapRequired.current) {
      void universe().then(data=>{
        if(!isCurrentTheme())return;
        const cached=themeSnapshots.current.get(theme);
        if(!cached||cached.eventsPending)themeSnapshots.current.set(theme,data);
        setSnapshot(current=>current&&!current.eventsPending?current:data);
      }).catch(()=>{});
    }
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const url=`/api/intelligence?theme=${theme}&graph=omit${fullEvents||company||query||region||selectedEvent||selectedRelationship||previousDay.current?'':'&payload=compact'}${company ? `&company=${encodeURIComponent(company)}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}${region?`&region=${encodeURIComponent(region)}`:''}${previousDay.current?`&before=${previousDay.current}`:''}`;
        const saved=responses.current.get(url);
        const response=await fetch(url,{cache:'no-store',signal:controller.signal,headers:saved?{'If-None-Match':saved.etag}:{}});
        if (!response.ok&&response.status!==304) throw new Error();
        const payload:IntelligencePayload=response.status===304&&saved?saved.data:await response.json();
        let data:IntelligenceSnapshot;
        if(payload.graph)data=payload as IntelligenceSnapshot;
        else {
          let graph=graphs.current.get(theme);
          if(!graph||graph.graphVersion!==payload.graphVersion){
            graph=await universe();
            // A graph update may race independently completed feed and directory reads.
            if(graph.graphVersion!==payload.graphVersion){
              universeRequest=undefined;graph=await universe();
              if(graph.graphVersion!==payload.graphVersion)throw Error('Graph changed during refresh');
            }
          }
          data={...payload,graph:graph.graph};
        }
        const etag=response.headers.get('etag');
        if(etag&&response.status!==304){
          if(responses.current.size>=30)responses.current.clear();
          responses.current.set(url,{etag,data});
        }
        if ((data.theme ?? 'ai') !== theme || !data.graphVersion || !Array.isArray(data.graph?.nodes) || !Array.isArray(data.events) || !data.session?.startAt) throw new Error();
        if (isCurrentTheme()) {
          const cachedGraph=graphs.current.get(theme);
          if(!cachedGraph||Date.parse(cachedGraph.generatedAt)<=Date.parse(data.generatedAt))graphs.current.set(theme,data);
          const old = themeSnapshots.current.get(theme);
          // Preserve the graph object on unchanged polls so camera tours continue.
          const next = old?.graphVersion === data.graphVersion ? { ...data, graph: old.graph } : data;
          if (!company&&!query&&!region) themeSnapshots.current.set(theme, next);
          if (themeIntent.current === theme) {
            themeIntent.current = null;
            updateIndustryBrowse(clearedThemeSelection);
          }
          snapshotScope.current = scope;
          bootstrapRequired.current = false;
          setSnapshot(next);
          previousDay.current=undefined;
          setError('');
        }
      } catch {
        if (isCurrentTheme()) setError('Unable to refresh investment intelligence.');
      } finally {
        clearTimeout(timeout);
        if(!disposed)setLoadingOlder(false);
        inFlight = false;
      }
    };
    if(serverFeedAvailable.current&&!company&&!query&&!region&&!selectedEvent&&!selectedRelationship&&!fullEvents&&!previousDay.current){
      serverFeedAvailable.current=false;
    }else{serverFeedAvailable.current=false;void refresh();}
    const timer = setInterval(() => void refresh(), 60_000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      disposed = true;
      controller?.abort();
      universeController.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [retry, theme, defaultTheme, company, query, region, scope, fullEvents, selectedEvent, selectedRelationship]);

  const loadPreviousDay = () => {
    if(loadingOlder||!snapshot?.feedWindow?.hasMore)return;
    setFullEvents(true);
    previousDay.current=snapshot.feedWindow.loadedFrom;
    setLoadingOlder(true);setRetry(value=>value+1);
  };
  const changeTheme = (next: CompanyThemeId) => {
    previousDay.current=undefined;setLoadingOlder(false);
    setError('');
    const cached = themeSnapshots.current.get(next), changed = next !== parseCompanyTheme(snapshot?.theme);
    themeIntent.current = changed && !cached ? next : null;
    if (cached) { snapshotScope.current = feedScope('','',''); setSnapshot(cached); }
    // Keep the visible selection until the new data is ready. Cancelling restores it.
    updateIndustryBrowse({ theme: next === 'ai' ? '' : next, ...(changed && cached ? clearedThemeSelection : {}) });
  };
  const reconnect = () => {
    if (snapshot) setError('');
    setRetry(value => value + 1);
  };

  // Clearing or switching a company immediately restores the theme feed while
  // its fresh company request is pending; stale scoped responses cannot win.
  const displayed = snapshotScope.current === scope ? snapshot : themeSnapshots.current.get(parseCompanyTheme(snapshot?.theme)) ?? snapshot;
  const searching = Boolean((query||region)&&snapshotScope.current!==scope)||Boolean(fullEvents&&displayed?.eventsLimited);
  return { snapshot: searching&&displayed?{...displayed,eventsPending:true}:displayed, theme, error, changeTheme, reconnect, loadPreviousDay, loadingOlder, loadFullEvents };
}
