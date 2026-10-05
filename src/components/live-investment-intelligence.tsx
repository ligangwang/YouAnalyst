"use client";
import { UiText, useUiText } from "./ui-text";
import { IntelligenceSectorLegend } from './intelligence-sector-legend';
import { lazy, Suspense, useEffect, useEffectEvent, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { LocalizedLink as Link } from './localized-link';
import { LanguageSwitch, useLocale } from './providers/locale-provider';
import { NavigationSettings } from './navigation-settings';
import { IntelligenceActivityOverview } from './intelligence-activity-overview';
import { IntelligenceEventCompanies } from './intelligence-event-companies';
import { IntelligenceThemeSelector } from './intelligence-theme-selector';
import { parseCompanyTheme, themeName, type CompanyThemeId } from '@/lib/company-themes/model';
import { IntelligenceViewTabs } from './intelligence-view-tabs';
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';
import { parseIndustryView, type IndustryView } from '@/lib/knowledge-graph/views';
import { curatedEvents } from '@/lib/knowledge-graph/curated-events';
import {ActiveCompanyMeter,PublicationActivity,SourceVolume} from './intelligence-summary-visuals';
import { AvatarButton } from './site-nav';
import { useCompanyFollows } from './company-follow-button';
import { companyName, companySearchRank, companySearchText, matchesCompanySearch } from '@/lib/knowledge-graph/model';
import { matchesCompanySector, graphSectors } from '@/lib/knowledge-graph/sectors';
import { researchCompanyUrl } from '@/lib/knowledge-graph/research-view';
import { relationshipVerification } from '@/lib/knowledge-graph/relationship-status';
import { sourceDocumentsForEvents, summarizeSourceDocuments, summarizeIntelligence, sourceChannel, type IntelligenceEvent, type IntelligenceSnapshot, type IntelligenceSource } from '@/lib/intelligence/model';
import styles from './investment-intelligence.module.css';
import controls from './intelligence-workspace-controls.module.css';
import summaryStyles from './intelligence-summary.module.css';
import liveStyles from './intelligence-live.module.css';
import viewStyles from './intelligence-center-views.module.css';

const Universe=lazy(()=>import('./company-graph-3d'));
const Tree=lazy(()=>import('./industry-tree').then(module=>({default:module.IndustryStructure})));
const Hierarchy=lazy(()=>import('./industry-hierarchy').then(module=>({default:module.IndustryHierarchy})));
const CompanyTable=lazy(()=>import('./industry-company-views').then(module=>({default:module.IndustryCompanyTable})));
type WorkspaceInitialState={initialTheme?:string;initialView?:string;initialCompany?:string;initialQuery?:string;initialEdge?:string;initialEvent?:string};
const subscribeWidth=(notify:()=>void)=>{const media=matchMedia('(min-width:1440px)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
const desktopWidth=()=>matchMedia('(min-width:1440px)').matches;
const clock=(value:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const shortDate=(value:string)=>value.slice(5);
type Panels={left:boolean|null;right:boolean};

/** Failure never falls back to demo data. Polls pause during replay and hidden tabs. */
export function LiveInvestmentIntelligence({initialSnapshot,...initialState}:{initialSnapshot?:IntelligenceSnapshot}&WorkspaceInitialState={}){
  const theme=parseCompanyTheme(useIndustryBrowseParam('theme','ai',initialState.initialTheme??'ai'));
  const [guestSaved,setGuestSaved]=useState<string[]>([]);
  const [panels,setPanels]=useState<Panels>({left:null,right:true});
  const [snapshot,setSnapshot]=useState<IntelligenceSnapshot|null>(initialSnapshot??null);
  const themeSnapshots=useRef(new Map<CompanyThemeId,IntelligenceSnapshot>(initialSnapshot?[[parseCompanyTheme(initialSnapshot.theme),initialSnapshot]]:[]));
  const themeIntent=useRef<CompanyThemeId|null>(null);
  const [error,setError]=useState(''),[replaying,setReplaying]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let disposed=false,inFlight=false;
    let controller:AbortController|null=null;
    const refresh=async()=>{
      if(disposed||inFlight||replaying||document.visibilityState==='hidden')return;
      inFlight=true;controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),15_000);
      try{
        const response=await fetch(`/api/intelligence?theme=${theme}`,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error();
        const data:IntelligenceSnapshot=await response.json();
        if((data.theme??'ai')!==theme||!data.graphVersion||!Array.isArray(data.graph?.nodes)||!Array.isArray(data.events)||!data.session?.startAt)throw new Error();
        if(!disposed&&parseCompanyTheme(new URLSearchParams(window.location.search).get('theme'))===theme){
          const old=themeSnapshots.current.get(theme);
          const next=old?.graphVersion===data.graphVersion?{...data,graph:old.graph}:data;
          themeSnapshots.current.set(theme,next);
          if(themeIntent.current===theme){themeIntent.current=null;updateIndustryBrowse({company:'',relationship:'',event:'',q:'',page:''});}
          setSnapshot(next);setError('');
        }
      }catch{if(!disposed&&parseCompanyTheme(new URLSearchParams(window.location.search).get('theme'))===theme)setError('Unable to refresh investment intelligence.');}
      finally{clearTimeout(timeout);inFlight=false;}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),60_000);
    const onVisible=()=>void refresh();
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('focus',onVisible);
    return()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);};
  },[replaying,retry,theme]);
  const changeTheme=(next:CompanyThemeId)=>{
    setReplaying(false);setError('');
    const cached=themeSnapshots.current.get(next),changed=next!==parseCompanyTheme(snapshot?.theme);
    themeIntent.current=changed&&!cached?next:null;
    if(cached)setSnapshot(cached);
    // Keep the visible selection until the new data is ready. Cancelling restores it.
    updateIndustryBrowse({theme:next==='ai'?'':next,...(changed&&cached?{company:'',relationship:'',event:'',q:'',page:''}:{})});
  };
  if(!snapshot)return <main className={liveStyles.loadingShell}><Link href="/" aria-label="YouAnalyst home"><Image src="/youanalyst-logo-mobile.svg" width={134} height={30} alt="YouAnalyst" priority/></Link><h1><UiText text={"Investment Intelligence"}/></h1><IntelligenceThemeSelector theme={theme} onChange={changeTheme}/><p role={error?'alert':'status'}><UiText text={error||'Loading companies and recorded events…'}/></p>{error&&<button onClick={()=>setRetry(value=>value+1)}><UiText text={"Retry connection"}/></button>}<nav aria-label="Research navigation"><Link href={theme!=='ai'?`/?theme=${theme}&view=graph`:'/?view=graph'}><UiText text={"Map"}/></Link><Link href="/research"><UiText text={"Research"}/></Link><Link href="/companies"><UiText text={"Companies"}/></Link><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA ecosystem"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD ecosystem"}/></Link></nav></main>;
  return <IntelligenceWorkspace panels={panels} setPanels={setPanels} {...initialState} guestSaved={guestSaved} setGuestSaved={setGuestSaved} snapshot={snapshot} theme={parseCompanyTheme(snapshot.theme)} requestedTheme={theme} changeTheme={changeTheme} error={error} reconnect={()=>{setError('');setRetry(value=>value+1);}} onReplayChange={setReplaying}/>;
}

function IntelligenceWorkspace({snapshot,panels,setPanels,theme,requestedTheme,changeTheme,guestSaved,setGuestSaved,error,reconnect,onReplayChange,initialView='',initialCompany='',initialQuery='',initialEdge='',initialEvent=''}:{snapshot:IntelligenceSnapshot;panels:Panels;setPanels:React.Dispatch<React.SetStateAction<Panels>>;theme:CompanyThemeId;requestedTheme:CompanyThemeId;changeTheme:(theme:CompanyThemeId)=>void;guestSaved:string[];setGuestSaved:React.Dispatch<React.SetStateAction<string[]>>;error:string;reconnect:()=>void;onReplayChange:(value:boolean)=>void}&WorkspaceInitialState){
  const {locale,chinese}=useLocale();
  const ui=useUiText();
  const follows=useCompanyFollows();
  const [saveError,setSaveError]=useState('');
  const sectors=graphSectors(theme);
  const name=themeName(theme,chinese);
  const switching=theme!==requestedTheme;
  const requestedName=themeName(requestedTheme,chinese);
  const [appliedTheme,setAppliedTheme]=useState(theme);
  const saved=follows.user?follows.ids:guestSaved;
  const wide=useSyncExternalStore(subscribeWidth,desktopWidth,()=>true);
  const leftChoice=panels.left,rightOpen=panels.right;
  const setLeftOpen=(left:boolean)=>setPanels(current=>({...current,left}));
  const setRightOpen=(right:boolean)=>setPanels(current=>({...current,right}));
  const leftOpen=leftChoice??wide;
  const [sector,setSector]=useState(''),[tab,setTab]=useState('all');
  const query=useIndustryBrowseParam('q','',initialQuery);
  const setQuery=(value:string)=>updateIndustryBrowse({q:value},true);
  const view=parseIndustryView(useIndustryBrowseParam('view','graph',initialView))??'graph';
  const viewId=useId();
  const changeView=(next:IndustryView)=>updateIndustryBrowse({view:next});
  const [sourceFilter,setSourceFilter]=useState<IntelligenceSource|''>(''),[activeOnly,setActiveOnly]=useState(false);
  const [window,setWindow]=useState<'today'|'recent'>(()=>(snapshot.sourceDocuments??sourceDocumentsForEvents(snapshot.events)).some(document=>document.publication_date===snapshot.session.date)?'today':'recent');
  const selectedPanel=useRef<HTMLElement>(null);
  const requestedCompany=useIndustryBrowseParam('company','',initialCompany);
  const eventId=useIndustryBrowseParam('event','',initialEvent),edgeId=useIndustryBrowseParam('relationship','',initialEdge);
  const setSelected=(company:string)=>updateIndustryBrowse({company});
  const setEventId=(event:string)=>updateIndustryBrowse({event});
  const setEdgeId=(relationship:string)=>updateIndustryBrowse({relationship});
  const requestedId=requestedCompany.includes(':')?requestedCompany.toUpperCase():requestedCompany?`US:${requestedCompany.toUpperCase()}`:'';
  const linkedEvent=theme==='ai'?curatedEvents.find(item=>item.id===eventId):undefined;
  const selected=requestedId||snapshot.events.find(item=>item.id===eventId)?.origin||linkedEvent?.companyIds[0]||snapshot.graph.relationships.find(item=>item.id===edgeId)?.source||'';
  const [camera,setCamera]=useState(0),[reset,setReset]=useState(0),[pulse,setPulse]=useState(0);
  const [mode,setMode]=useState<'live'|'replay'>('live'),[playing,setPlaying]=useState(false),[propagating,setPropagating]=useState(false);
  const start=Date.parse(snapshot.session.startAt),until=Date.parse(snapshot.generatedAt);
  const end=Math.max(1,Math.ceil((until-start)/60_000));
  const [minute,setMinute]=useState(end);
  const cutoff=mode==='replay'?Math.min(until,start+minute*60_000):undefined;
  const graph=snapshot.graph;
  const allCompanies=useMemo(()=>graph.nodes.filter(node=>node.kind==='COMPANY'),[graph]);
  const companiesById=useMemo(()=>new Map(allCompanies.map(company=>[company.id,company])),[allCompanies]);
  const scope=useMemo(()=>allCompanies.filter(node=>(!sector||matchesCompanySector(node,sector))&&(!query||matchesCompanySearch(companySearchText(graph,node),query.normalize('NFKC').trim().replace(/^\$/,'')))&&(tab!=='watchlist'||saved.includes(node.id))).sort((a,b)=>query?companySearchRank(a,query)-companySearchRank(b,query):0),[allCompanies,graph,sector,query,tab,saved]);
  const inWindow=snapshot.events.filter(event=>window==='recent'||event.publication_date===snapshot.session.date);
  const scopeIds=scope.map(node=>node.id);
  const sourceDocuments=snapshot.sourceDocuments??sourceDocumentsForEvents(snapshot.events);
  const periodDocuments=sourceDocuments.filter(document=>window==='recent'||document.publication_date===snapshot.session.date);
  const loadedActivity=summarizeIntelligence(inWindow,scopeIds,sourceFilter,cutoff);
  const activity={...loadedActivity,...summarizeSourceDocuments(periodDocuments,scopeIds,sourceFilter,cutoff)};
  const sourceActivity=summarizeSourceDocuments(periodDocuments,scopeIds,'',cutoff).sources.filter(source=>snapshot.coverage.some(item=>item.channel===source.name&&item.status!=='unavailable')&&(source.name!=='Other'||source.count>0));
  const events=activity.events;
  const recentFallback=mode==='live'&&window==='today'&&activity.signals===0;
  const overviewEvents=events;
  const activeIds=new Set(activity.activeIds);
  const companies=scope.filter(node=>(!activeOnly&&!sourceFilter)||activeIds.has(node.id));
  const company=allCompanies.find(node=>node.id===selected);
  // Research bookmarks may refer to editorial events outside the collected feed.
  // They populate the selection only; recorded activity totals remain unchanged.
  const editorialEvent:IntelligenceEvent|undefined=linkedEvent&&linkedEvent.companyIds.some(id=>companiesById.has(id))?{
    id:linkedEvent.id,origin:linkedEvent.companyIds[0],companyIds:linkedEvent.companyIds,
    edgeIds:linkedEvent.relationshipId?[linkedEvent.relationshipId]:[],category:'BUSINESS',
    title:chinese?linkedEvent.titleZh:linkedEvent.title,summary:chinese?linkedEvent.summaryZh:linkedEvent.summary,
    published_at:null,publication_date:linkedEvent.sourceDate,eventDate:linkedEvent.eventDate,planned:linkedEvent.planned,
    evidence:[{id:linkedEvent.id,url:linkedEvent.sourceUrl,title:linkedEvent.sourceTitle,sourceDate:linkedEvent.sourceDate,channel:sourceChannel(linkedEvent.sourceUrl)}],
  }:undefined;
  const event=snapshot.events.find(item=>item.id===eventId)??editorialEvent;
  const connections=graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(event?event.edgeIds.includes(edge.id):selected&&(edge.source===selected||edge.target===selected)));
  const intelligence={origin:propagating?event?.origin??'':'',edges:event?propagating?event.edgeIds:[]:selected?graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(edge.source===selected||edge.target===selected)).map(edge=>edge.id):[]};
  const filteredCompanyIds=activeOnly||sourceFilter?activity.activeIds:query||tab==='watchlist'||(theme!=='ai'&&sector)?scopeIds:undefined;
  const replayEvents=snapshot.events.filter(item=>item.publication_date===snapshot.session.date&&item.published_at);
  const latestBefore=(value:number)=>summarizeIntelligence(snapshot.events.filter(item=>item.publication_date===snapshot.session.date),scopeIds,sourceFilter,Math.min(until,start+value*60_000)).events[0];
  const label=(id:string)=>{const node=companiesById.get(id);return node?.symbol||node?.name||id;};

  function clearSelection(){updateIndustryBrowse({company:'',event:'',relationship:''});setPropagating(false);}
  function showEvents(){setRightOpen(true);clearSelection();}
  function focusCompany(id:string){if(!id||id===selected&&!eventId&&!edgeId){clearSelection();return;}clearSelection();setRightOpen(true);setSelected(id);setCamera(value=>value+1);}
  function activate(id:string){const next=snapshot.events.find(item=>item.id===id);if(!next)return;setRightOpen(true);setEventId(id);setSelected(next.origin);setEdgeId('');setCamera(value=>value+1);setPropagating(true);setPulse(value=>value+1);}
  function goLive(){setMode('live');setPlaying(false);onReplayChange(false);clearSelection();setReset(value=>value+1);}
  function replayAt(value:number){setMinute(value);const next=latestBefore(value);if(next)activate(next.id);else clearSelection();}
  async function toggleSaved(id:string){
    setSaveError('');
    if(!follows.user){setGuestSaved(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);return;}
    try{await follows.change(id,!saved.includes(id));}catch{setSaveError('Could not save this company. Retry.');}
  }
  useEffect(()=>{if(selected||eventId)selectedPanel.current?.focus({preventScroll:true});},[selected,eventId]);
  useEffect(()=>{if(!propagating)return;const timer=setTimeout(()=>setPropagating(false),20_000);return()=>clearTimeout(timer);},[propagating,pulse]);
  const replayTick=useEffectEvent(()=>{const value=Math.min(end,minute+1);setMinute(value);const next=latestBefore(value);if(next&&next.id!==eventId)activate(next.id);if(value===end)setPlaying(false);});
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>replayTick(),200);return()=>clearInterval(timer);},[playing]);

  // Reset theme-specific filters before committing the new contents, keeping the workspace mounted.
  if(appliedTheme!==theme){setAppliedTheme(theme);setSector('');setTab('all');setSourceFilter('');setActiveOnly(false);setMode('live');setPlaying(false);setPropagating(false);setMinute(end);}
  if(switching&&playing)setPlaying(false);

  return <main className={`${styles.shell} ${leftOpen?'':styles.leftClosed} ${rightOpen?'':styles.rightClosed}`}>
    <header className={styles.topbar}>
      <div className={styles.identity}><Link href="/" aria-label="YouAnalyst home"><Image src="/youanalyst-logo-mobile.svg" width={134} height={30} alt="YouAnalyst" priority/></Link><h1 className={styles.srOnly}><UiText text={"Investment Intelligence"}/></h1></div>
      <nav className={styles.navigation} aria-label="Workspace navigation"><Link href={theme!=='ai'?`/?theme=${theme}&view=graph`:'/?view=graph'}><UiText text={"Map ↗"}/></Link><Link href="/feed">{chinese?'精选研究':'Research feed'}</Link><Link href="/watchlists/following"><UiText text={"Watchlists"}/></Link></nav>
      <div className={styles.session}><div className={controls.liveControls}><span className={controls.liveStatus}><UiText text={mode==='replay'?'Replay':error?'Disconnected':chinese?'实时':'Live'}/> <small>{mode==='replay'?snapshot.session.date:clock(until)+' ET'}</small></span>{mode==='live'&&<button disabled={!replayEvents.length} title={replayEvents.length?'Replay today’s published events':'No events with exact publication time today'} aria-controls="intraday-replay" onClick={()=>{setWindow('today');setMode('replay');setMinute(end);setPlaying(false);clearSelection();onReplayChange(true);}}><UiText text={"Replay"}/></button>}</div><details className={controls.more} onKeyDown={key=>{if(key.key==='Escape'){key.currentTarget.open=false;key.currentTarget.querySelector('summary')?.focus();}}}><summary><UiText text={"More ▾"}/></summary><nav aria-label="More navigation">{[['/feed','Research feed'],['/watchlists/following','Watchlists'],['/research','Research'],['/companies','Companies'],['/predictions','Investment ideas'],['/my/predictions','My ideas'],['/compare','Performance comparison'],['/predictions/new','Publish an idea'],['/daily/calls','Top Calls'],['/how-it-works','How it works']].map(([href,title])=><Link key={href} href={href}><UiText text={title}/></Link>)}</nav></details><div className={controls.languageSwitch}><LanguageSwitch/></div><Link className={styles.account} href={follows.user?`/analysts/${follows.user.uid}`:'/auth'} aria-label={ui(follows.user?'Account':'Sign in')} title={follows.user?.displayName||ui(follows.user?'Account':'Sign in')}>{follows.user?<AvatarButton compact photoURL={follows.user.photoURL} displayName={follows.user.displayName} email={follows.user.email}/>:<UiText text={'Sign in'}/>}</Link></div>
    </header>
    <aside className={styles.left} aria-label="Universe navigation" data-filtered={Boolean(query)||tab==='watchlist'||activeOnly||Boolean(sourceFilter)}>
      <div className={styles.panelTitle}><strong><UiText text={"Explore universe"}/></strong><button aria-label="Collapse left panel" onClick={()=>setLeftOpen(false)}>‹</button></div>
      <label className={styles.search}><span className={styles.srOnly}><UiText text={"Search companies"}/></span><input disabled={switching} value={query} onChange={change=>{setQuery(change.target.value);clearSelection();}} placeholder={ui('Search company / ticker')}/></label>
      <div className={styles.sectionLabel}><UiText text={"INVESTMENT THEME"}/></div><IntelligenceThemeSelector theme={requestedTheme} onChange={changeTheme} count={switching?undefined:allCompanies.length}/>
      <div className={liveStyles.themeFilters} inert={switching}>
      <div className={styles.sectionLabel}><UiText text={"SECTORS"}/>{' '}<button aria-label="Clear sector focus" onClick={()=>{setSector('');clearSelection();}}><UiText text={"All"}/></button></div>
      <div className={styles.sectors}>{sectors.map(item=><button key={item.id} aria-pressed={sector===item.id} onClick={()=>{setSector(sector===item.id?'':item.id);clearSelection();setCamera(value=>value+1);}}><span style={{background:item.color}}/>{chinese?item.zh:item.en}<small>{allCompanies.filter(node=>matchesCompanySector(node,item.id)).length}</small></button>)}</div>
      {theme==='ai'&&<nav className={controls.researchShortcuts} aria-label="Research shortcuts"><div className={controls.researchHeading}><UiText text={"RESEARCH"}/>{' '}<Link href="/research"><UiText text={"All ↗"}/></Link></div><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA suppliers & ecosystem ↗"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD deployments & ecosystem ↗"}/></Link><button onClick={()=>{setSector('infrastructure');clearSelection();setCamera(value=>value+1);}}><UiText text={"AI infrastructure bottlenecks →"}/></button></nav>}
      <div className={styles.listTabs}><button aria-pressed={tab==='all'} onClick={()=>{setTab('all');clearSelection();}}><UiText text={"Companies"}/></button><button aria-pressed={tab==='watchlist'} onClick={()=>{setTab('watchlist');clearSelection();}}><UiText text={"Watchlist"}/>{' '}<small>{saved.length}</small></button></div>
      <div className={styles.companyList}>{companies.map(node=><div key={node.id} className={selected===node.id?styles.selectedCompany:undefined}><button onClick={()=>focusCompany(node.id)}><strong>{node.symbol||node.name}</strong><span>{companyName(node,locale)}</span></button><button aria-label={`${saved.includes(node.id)?'Unsave':'Save'} ${node.symbol||node.name}`} aria-pressed={saved.includes(node.id)} disabled={Boolean(follows.user)&&!follows.ready} onClick={()=>void toggleSaved(node.id)}>{saved.includes(node.id)?'★':'☆'}</button></div>)}{!companies.length&&<p className={styles.empty}><UiText text={"No matching companies."}/></p>}</div>
      <div className={styles.leftFoot}><UiText text={saveError||(!follows.user&&saved.length?'Session watchlist · sign in to persist':'Company universe with published sources')}/></div>
      </div>
    </aside>
    <section className={styles.center} aria-label="Graph universe">
      <div className={styles.graphToolbar}><div>{!leftOpen&&<button aria-label="Expand left panel" onClick={()=>setLeftOpen(true)}><UiText text={"☰ Explore"}/></button>}{!leftOpen&&<IntelligenceThemeSelector compact theme={requestedTheme} onChange={changeTheme}/>}<IntelligenceViewTabs view={view} onChange={changeView} id={viewId}/></div><div>{(view==='graph'||view==='tree')&&<NavigationSettings compact/>}<button disabled={switching} aria-label="Reset universe view" onClick={()=>{clearSelection();setSector('');setSourceFilter('');setActiveOnly(false);setReset(value=>value+1);}}><UiText text={"Reset ⤢"}/></button>{!rightOpen&&<button onClick={()=>setRightOpen(true)}><UiText text={"Events ›"}/></button>}</div></div>
      {error&&!switching&&<div className={liveStyles.notice} role="alert"><UiText text={"Connection interrupted. Showing the last received data."}/>{' '}<button onClick={reconnect}><UiText text={"Retry"}/></button></div>}
      <div className={viewStyles.panel} role="tabpanel" id={`${viewId}-panel`} aria-labelledby={`${viewId}-${view}`} tabIndex={0}>
        <div className={liveStyles.themeContents} inert={switching} aria-busy={switching&&!error}>
        {view==='graph'?<div className={styles.graph} style={{height:"100%"}}><Suspense fallback={<p className={styles.loading} role="status"><UiText text={"Loading universe…"}/></p>}><Universe graph={graph} selected={selected} onSelect={focusCompany} sectorFocus={theme!=='ai'?'':sector} cameraRequest={camera} reset={reset} onReset={()=>setReset(value=>value+1)} intelligence={intelligence} companyFocus={filteredCompanyIds} activeEdge={edgeId} onSelectEdge={setEdgeId} hideReset/></Suspense><IntelligenceSectorLegend theme={theme}/>{event&&<div className={styles.eventOverlay}><span className={styles.sectionLabel}>{event.category} · {event.published_at?clock(Date.parse(event.published_at))+' ET':event.publication_date}</span><strong>{event.title}</strong><span>{event.evidence.length}{' '}<UiText text={"source document ·"}/>{' '}{connections.length}{' '}<UiText text={"documented research paths"}/></span></div>}</div>:<Suspense fallback={<p className={styles.loading} role="status"><UiText text={"Loading universe…"}/></p>}>
          {view==='tree'?<Tree key={reset} embedded vertical companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved} active showCard={false}/>:view==='hierarchy'?<Hierarchy key={reset} embedded companies={companies} selected={selected} onSelect={focusCompany} closing={false}/>:<div className={viewStyles.table}><CompanyTable companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved}/></div>}
        </Suspense>}
        </div>
        {switching&&<div className={liveStyles.themeProgress} role={error?'alert':'status'} aria-live="polite">
          {!error&&<span className={liveStyles.themeSpinner} aria-hidden="true"/>}
          <span>{error?(chinese?`无法加载${requestedName}。仍显示${name}。`:`Could not load ${requestedName}. Still showing ${name}.`):(chinese?`正在加载${requestedName}…`:`Loading ${requestedName}…`)}</span>
          {error&&<button onClick={reconnect}><UiText text="Retry"/></button>}
          <button onClick={()=>changeTheme(theme)}><UiText text="Cancel"/></button>
        </div>}
      </div>
      {mode==='replay'&&<section id="intraday-replay" className={styles.timeline} aria-label="Today's intraday replay"><div className={styles.timelineHeading}><strong><UiText text={"Today’s published events"}/></strong><span>{snapshot.session.date}{' '}<UiText text={"· ET"}/></span><output>{clock(Math.min(until,start+minute*60_000))}</output><button onClick={goLive}><UiText text={"Back to live"}/></button></div><div className={styles.timeControl}><button aria-label={playing?'Pause replay':'Play replay'} onClick={()=>{if(!playing&&minute===end)replayAt(0);setPlaying(value=>!value);}}>{playing?'Ⅱ':'▶'}</button><div className={styles.timeTrack}><label htmlFor="intelligence-time" className={styles.srOnly}><UiText text={"Replay time"}/></label><input id="intelligence-time" type="range" min={0} max={end} value={Math.min(minute,end)} onChange={change=>{setPlaying(false);replayAt(Number(change.target.value));}}/><div className={styles.eventTicks}>{replayEvents.map(item=><button key={item.id} aria-label={`Replay ${item.title}`} title={item.title} style={{left:`${Math.min(100,(Date.parse(item.published_at!)-start)/(end*60_000)*100)}%`}} onClick={()=>{setPlaying(false);replayAt(Math.ceil((Date.parse(item.published_at!)-start)/60_000));}}><i/></button>)}</div><div className={styles.timeLabels}><span>00:00</span><span>{clock(until)}</span></div></div></div><div className={styles.timelineFoot}><UiText text={"Replay uses source publication time. Date-only events are excluded from intraday replay."}/></div></section>}
      <section className={summaryStyles.summary} aria-label="Theme activity summary" inert={switching}><div className={summaryStyles.period} role="group" aria-label={chinese?'活动统计时间范围':'Activity period'}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection();}}>{ui('Today')}</button><button aria-pressed={window==='recent'} disabled={mode==='replay'} title={ui('Last 30 days')} onClick={()=>{setWindow('recent');clearSelection();}}>30d</button></div><span className={summaryStyles.context} title={chinese?'统计涵盖当前时段已收录的来源文档。':'Totals cover recorded source documents in the selected period.'}>{name}{!snapshot.statisticsComplete&&(chinese?' · 部分数据':' · Partial')}{(!snapshot.statisticsComplete||snapshot.warnings.length>0)&&<span role="img" aria-label={ui('partial coverage')} title={ui('partial coverage')}> · ◐</span>}</span>{snapshot.newsCoverage&&<span className={summaryStyles.context} title={`${snapshot.newsCoverage.healthy} / ${snapshot.newsCoverage.configured} ${chinese?'采集器正常':'collectors healthy'}`} aria-label={chinese?'公司新闻采集覆盖':'Company news collector coverage'}>{chinese?'新闻':'News'} {snapshot.newsCoverage.configured}/{snapshot.newsCoverage.total}</span>}<button aria-label="Filter to active companies" aria-pressed={activeOnly} onClick={()=>{setActiveOnly(value=>!value);showEvents();}}><span><UiText text={"Active companies"}/></span><strong>{activity.activeIds.length} / {scope.length}</strong><ActiveCompanyMeter active={activity.activeIds.length} total={scope.length}/></button><button onClick={showEvents} aria-controls="intelligence-event-stream"><span><UiText text={"Source documents"}/></span><strong>{activity.signals}</strong><PublicationActivity events={activity.documents} start={window==='today'?start:until-30*86_400_000} end={cutoff??until} label={ui('Activity by source publication time')}/></button><div className={summaryStyles.sources}><span><UiText text={"Sources"}/></span>{sourceActivity.map(source=>{const available=snapshot.coverage.find(item=>item.channel===source.name)?.status!=='unavailable';return <button key={source.name} aria-label={`Filter ${source.name} signals`} aria-pressed={sourceFilter===source.name} disabled={!available} title={available?'Recorded source documents':'Source not connected'} onClick={()=>{setSourceFilter(sourceFilter===source.name?'':source.name);showEvents();}}>{source.name==='Exchange'?(chinese?'交易所公告':'Exchange filings'):source.name}<strong>{available?source.count:'—'}</strong><SourceVolume source={source.name} count={source.count} max={Math.max(0,...sourceActivity.map(item=>item.count))} available={available}/></button>;})}</div>{(activeOnly||sourceFilter)&&<button className={summaryStyles.clear} onClick={()=>{setActiveOnly(false);setSourceFilter('');showEvents();}}><UiText text={"Clear activity filters"}/></button>}</section>
    </section>
    <aside className={`${styles.right} ${liveStyles.rightPanel}`} aria-label="Events and sources" inert={switching}><div className={styles.panelTitle}><strong><UiText text={"What’s moving the universe"}/></strong><button aria-label="Collapse right panel" onClick={()=>setRightOpen(false)}>›</button></div><div className={liveStyles.windowControls}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection();}}><UiText text={"Today"}/></button><button aria-pressed={window==='recent'} disabled={mode==='replay'} onClick={()=>{setWindow('recent');clearSelection();}}>{chinese?'近 30 天':'30d'}</button></div>{(event||company)&&<section ref={selectedPanel} tabIndex={-1} aria-label={ui('Selected sources')} className={`${styles.evidence} ${liveStyles.selectedPanel}`} onKeyDown={key=>{if(key.key==='Escape')clearSelection();}}><div className={styles.panelTitle}><strong>{event?ui('Selected event'):company?companyName(company,locale):''}</strong><button aria-label="Close selected sources" onClick={clearSelection}>×</button></div>{event?<><p>{event.summary}</p><div className={liveStyles.dates}><UiText text={"Published"}/>{' '}{event.published_at?new Date(event.published_at).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':event.publication_date+' ('+ui('date only')+')'}{event.eventDate&&<><br/><UiText text={"Business / filing date"}/>{' '}{event.eventDate}</>}</div><nav aria-label="Primary sources" className={liveStyles.evidenceLinks}>{event.evidence.map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.channel} · {source.title} ↗<small>{source.sourceDate?ui('Published')+' '+source.sourceDate:ui('Publication date unavailable')}</small></a>)}</nav></>:<p>{company?.summary||'Explore the company’s published relationship sources.'}<button className={styles.saveButton} onClick={()=>void toggleSaved(selected)}><UiText text={saved.includes(selected)?'★ Saved':'☆ Save company'}/></button></p>}<h2><UiText text={"Research connections"}/></h2><div className={styles.researchPaths}>{connections.map(edge=><button key={edge.id} aria-pressed={edgeId===edge.id} onClick={()=>{setEdgeId(edge.id);setSelected(edge.source);setCamera(value=>value+1);}}><span>{label(edge.source)} <i>→</i> {label(edge.target)}</span><small>{edge.summary}</small></button>)}{!connections.length&&<p><UiText text={"No documented relationship paths for this signal."}/></p>}</div>{!event&&company&&<nav aria-label="Company research" className={liveStyles.evidenceLinks}><Link href={researchCompanyUrl(company)}><UiText text={"Company research ↗"}/></Link>{graph.sources.filter(source=>connections.some(edge=>edge.sourceIds.includes(source.id))||(theme!=='ai'&&company.sourceIds?.includes(source.id))).slice(0,8).map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</nav>}<p className={styles.evidenceNote}><UiText text={"Source activity and research relevance do not indicate price direction or verify that an announced plan has been delivered."}/></p></section>}<div className={liveStyles.rightBody}><div className={styles.eventSummary}><span>{loadedActivity.signals}{' '}{chinese?'份已加载来源文档':'loaded source documents'}</span><span><UiText text={"Updated ·"}/>{' '}{clock(until)}{' '}<UiText text={"ET"}/></span></div>{recentFallback&&<p className={styles.empty}><UiText text={"No new events in the available records today."}/><button onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"View recent events →"}/></button></p>}<IntelligenceActivityOverview events={overviewEvents} documents={activity.documents} complete={snapshot.statisticsComplete} companies={scope} recentFallback={false} period={window==='recent'?'recent':mode==='replay'?'replay':'today'} sourceFilter={sourceFilter} limit={snapshot.limit} truncated={snapshot.truncated} onSector={id=>{if(recentFallback)setWindow('recent');setSector(id);clearSelection();setCamera(value=>value+1);}} onSource={source=>{if(recentFallback)setWindow('recent');setSourceFilter(source);clearSelection();}} onEvent={id=>{setWindow('recent');activate(id);}}/><div id="intelligence-event-stream" className={styles.eventList}>{events.map(item=><button key={item.id} aria-pressed={eventId===item.id} onClick={()=>{setPlaying(false);activate(item.id);}}><div><span><UiText text={item.category}/></span><time dateTime={item.published_at??item.publication_date}>{item.published_at?(item.publication_date===snapshot.session.date?'':shortDate(item.publication_date)+' ')+clock(Date.parse(item.published_at)):shortDate(item.publication_date)+' · '+ui('date only')}</time></div><strong>{item.title}</strong><IntelligenceEventCompanies companyIds={item.companyIds} companies={companiesById} chinese={chinese}/><small>{item.evidence.length}{' '}<UiText text={"source document"}/><UiText text={item.planned?' · announced plan':''}/><span>↗</span></small></button>)}{!events.length&&!recentFallback&&<p className={styles.empty}>{activity.signals>0?(chinese?`匹配的来源未包含在最新 ${snapshot.limit} 条列表中，但已计入统计。`:`Matching sources are outside the latest ${snapshot.limit} entries shown, but are included in the totals.`):<UiText text={mode==='replay'?'No events published before this time.':window==='today'?'No new events in the available records today.':'No recorded events match these filters.'}/>} {mode==='live'&&window==='today'&&activity.signals===0&&<button onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"View recent events →"}/></button>}</p>}</div>

      </div><details className={styles.rightFoot}><summary>{chinese?'来源状态':'Source status'}{(!snapshot.statisticsComplete||snapshot.warnings.length>0)?' · ◐':''}</summary><p><UiText text={"Counts deduplicate source documents."}/></p>{snapshot.truncated&&<p>{chinese?`列表显示最新 ${snapshot.limit} 条；统计独立于列表上限。`:`The list shows the latest ${snapshot.limit} entries; totals are independent of the list limit.`}</p>}{snapshot.newsCoverage&&<p>{chinese?'公司新闻覆盖':'Company news coverage'} {snapshot.newsCoverage.configured}/{snapshot.newsCoverage.total} · {snapshot.newsCoverage.healthy} {chinese?'正常':'healthy'}</p>}{snapshot.warnings.map(warning=><p key={warning}><UiText text={warning}/></p>)}</details>
    </aside>
  </main>;
}
