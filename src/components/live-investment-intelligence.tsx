"use client";

import { IntelligenceLoadingShell } from './intelligence-loading-shell';
import { useNodeCardPosition } from './use-node-card-position';
import { GraphCompanyOutlook } from "./company-outlook";
import { UiText, useUiText } from "./ui-text";
import { IntelligenceSectorLegend } from './intelligence-sector-legend';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LocalizedLink as Link } from './localized-link';
import { useLocale } from './providers/locale-provider';
import { NavigationSettings } from './navigation-settings';
import { IntelligenceActivityOverview } from './intelligence-activity-overview';
import { RelativeTime } from "./relative-time";
import { IntelligencePricePerformance } from './intelligence-price-performance';
import { IntelligencePriceAsOf } from './intelligence-price-as-of';
import { IntelligenceEventCompanies } from './intelligence-event-companies';
import { IntelligenceCalendarLinks } from './intelligence-calendar-links';
import { IntelligenceThemeSelector } from './intelligence-theme-selector';
import { parseCompanyTheme, themeName, type CompanyThemeId } from '@/lib/company-themes/model';
import { IntelligenceViewTabs } from './intelligence-view-tabs';
import { useIntelligenceSnapshot } from './use-intelligence-snapshot';
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';
import { parseIndustryView, type IndustryView } from '@/lib/knowledge-graph/views';
import { curatedEvents } from '@/lib/knowledge-graph/curated-events';
import {ActiveCompanyMeter,PublicationActivity,SourceVolume} from './intelligence-summary-visuals';
import { useCompanyFollows } from './company-follow-button';
import { CompanyFollowStar, CompanyFollowConfirmation, type FollowFeedbackAnchor } from './company-follow-star';
import { relationshipSourceTitle, relationshipSummary, companySummary, companyName, companySearchRank, companySearchText, matchesCompanySearch } from '@/lib/knowledge-graph/model';
import { matchesCompanySector, graphSectors } from '@/lib/knowledge-graph/sectors';
import { researchCompanyUrl } from '@/lib/knowledge-graph/research-view';
import { relationshipVerification } from '@/lib/knowledge-graph/relationship-status';
import { intelligenceEventTitle, sourceDocumentsForEvents, summarizeSourceDocuments, summarizeIntelligence, sourceChannel, type IntelligenceEvent, type IntelligenceSnapshot, type IntelligenceSource } from '@/lib/intelligence/model';
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

/** Failure never falls back to demo data. Polls pause in hidden tabs. */
export function LiveInvestmentIntelligence({initialSnapshot,...initialState}:{initialSnapshot?:IntelligenceSnapshot}&WorkspaceInitialState={}){
  const {snapshot,theme,error,changeTheme,reconnect}=useIntelligenceSnapshot(initialSnapshot,initialState.initialTheme);
  const [guestSaved,setGuestSaved]=useState<string[]>([]);
  const [panels,setPanels]=useState<Panels>({left:null,right:true});
  if(!snapshot)return <IntelligenceLoadingShell theme={theme} onThemeChange={changeTheme} error={error} onRetry={reconnect}/>;
  return <IntelligenceWorkspace panels={panels} setPanels={setPanels} {...initialState} guestSaved={guestSaved} setGuestSaved={setGuestSaved} snapshot={snapshot} theme={parseCompanyTheme(snapshot.theme)} requestedTheme={theme} changeTheme={changeTheme} error={error} reconnect={reconnect}/>;
}

function IntelligenceWorkspace({snapshot,panels,setPanels,theme,requestedTheme,changeTheme,guestSaved,setGuestSaved,error,reconnect,initialView='',initialCompany='',initialQuery='',initialEdge='',initialEvent=''}:{snapshot:IntelligenceSnapshot;panels:Panels;setPanels:React.Dispatch<React.SetStateAction<Panels>>;theme:CompanyThemeId;requestedTheme:CompanyThemeId;changeTheme:(theme:CompanyThemeId)=>void;guestSaved:string[];setGuestSaved:React.Dispatch<React.SetStateAction<string[]>>;error:string;reconnect:()=>void}&WorkspaceInitialState){
  const {locale,chinese}=useLocale();
  const ui=useUiText();
  const follows=useCompanyFollows();
  const [saveError,setSaveError]=useState('');
  const [followConfirmation,setFollowConfirmation]=useState<{label:string;followed:boolean;id:number;anchor?:FollowFeedbackAnchor}|null>(null);
  useEffect(()=>{if(!followConfirmation)return;const timer=setTimeout(()=>setFollowConfirmation(null),2200);return()=>clearTimeout(timer);},[followConfirmation]);
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
  const changeView=(next:IndustryView)=>{updateIndustryBrowse({view:next});};
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
  const [propagating,setPropagating]=useState(false);
  const start=Date.parse(snapshot.session.startAt),until=Date.parse(snapshot.generatedAt);
  const graph=snapshot.graph;
  const allCompanies=useMemo(()=>graph.nodes.filter(node=>node.kind==='COMPANY'),[graph]);
  const companiesById=useMemo(()=>new Map(allCompanies.map(company=>[company.id,company])),[allCompanies]);
  const scope=useMemo(()=>{
    const search=query.normalize('NFKC').trim().replace(/^\$/,'');
    const exact=search?allCompanies.filter(node=>companySearchRank(node,search)===0):[];
    const candidates=exact.length?exact:allCompanies;
    return candidates.filter(node=>(!sector||matchesCompanySector(node,sector))&&(!search||exact.length>0||matchesCompanySearch(companySearchText(graph,node),search))&&(tab!=='watchlist'||saved.includes(node.id))).sort((a,b)=>search?companySearchRank(a,search)-companySearchRank(b,search):0);
  },[allCompanies,graph,sector,query,tab,saved]);
  const inWindow=snapshot.events.filter(event=>window==='recent'||event.publication_date===snapshot.session.date);
  const scopeIds=scope.map(node=>node.id);
  const sourceDocuments=snapshot.sourceDocuments??sourceDocumentsForEvents(snapshot.events);
  const periodDocuments=sourceDocuments.filter(document=>window==='recent'||document.publication_date===snapshot.session.date);
  const loadedActivity=summarizeIntelligence(inWindow,scopeIds,sourceFilter);
  const activity={...loadedActivity,...summarizeSourceDocuments(periodDocuments,scopeIds,sourceFilter)};
  const sourceActivity=summarizeSourceDocuments(periodDocuments,scopeIds,'').sources.filter(source=>snapshot.coverage.some(item=>item.channel===source.name&&item.status!=='unavailable')&&(source.name!=='Other'||source.count>0));
  const events=activity.events;
  const recentFallback=window==='today'&&activity.signals===0;
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
  const clickAnchor=useRef<{x:number;y:number}|null>(null);
  const [companyAnchor,setCompanyAnchor]=useState<{x:number;y:number}|null>(null);
  const floatingCompany=Boolean(company)&&!event;
  const companyCard=useNodeCardPosition(selected,'workspace',floatingCompany,companyAnchor);
  const eventSource=event?.evidence.find(source=>source.channel==='SEC')??event?.evidence[0];
  const connections=graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(event?event.edgeIds.includes(edge.id):selected&&(edge.source===selected||edge.target===selected)));
  const intelligence={origin:propagating?event?.origin??'':'',edges:event?propagating?event.edgeIds:[]:selected?graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(edge.source===selected||edge.target===selected)).map(edge=>edge.id):[]};
  const filteredCompanyIds=activeOnly||sourceFilter?activity.activeIds:query||tab==='watchlist'||(theme!=='ai'&&sector)?scopeIds:undefined;
  const label=(id:string)=>{const node=companiesById.get(id);return node?.symbol||node?.name||id;};

  function clearSelection(){updateIndustryBrowse({company:'',event:'',relationship:''});setPropagating(false);}
  function showEvents(){setRightOpen(true);clearSelection();}
  function focusCompany(id:string){if(!id||id===selected&&!eventId&&!edgeId){clearSelection();return;}clearSelection();setCompanyAnchor(clickAnchor.current);setSelected(id);setCamera(value=>value+1);}
  function activate(id:string){const next=snapshot.events.find(item=>item.id===id);if(!next)return;setRightOpen(true);setEventId(id);setSelected(next.origin);setEdgeId('');setCamera(value=>value+1);setPropagating(true);setPulse(value=>value+1);}
  async function changeSaved(id:string,follow:boolean,anchor?:FollowFeedbackAnchor){
    setSaveError('');
    if(!follows.user)setGuestSaved(ids=>follow?(ids.includes(id)?ids:[...ids,id]):ids.filter(item=>item!==id));
    else await follows.change(id,follow);
    setFollowConfirmation(current=>({label:label(id),followed:follow,anchor,id:(current?.id??0)+1}));
  }
  async function toggleSaved(id:string,event:React.MouseEvent<HTMLButtonElement>){
    const bounds=event.currentTarget.getBoundingClientRect();
    const anchor=event.detail?{x:event.clientX,y:event.clientY}:{x:bounds.right,y:bounds.bottom};
    try{await changeSaved(id,!saved.includes(id),anchor);}catch{setSaveError('Could not save this company. Retry.');}
  }
  useEffect(()=>{if(selected||eventId)(floatingCompany?companyCard:selectedPanel).current?.focus({preventScroll:true});},[selected,eventId,floatingCompany,companyCard]);
  useEffect(()=>{if(!propagating)return;const timer=setTimeout(()=>setPropagating(false),20_000);return()=>clearTimeout(timer);},[propagating,pulse]);

  // Reset theme-specific filters before committing the new contents, keeping the workspace mounted.
  if(appliedTheme!==theme){setAppliedTheme(theme);setSector('');setTab('all');setSourceFilter('');setActiveOnly(false);setPropagating(false);}

  const selectedDetails=(event||company)?<section ref={floatingCompany?companyCard:selectedPanel} tabIndex={-1} aria-label={floatingCompany?ui('Company details'):ui('Selected sources')} className={`${styles.evidence} ${liveStyles.selectedPanel} ${floatingCompany?liveStyles.companyCard:""}`} onKeyDown={key=>{if(key.key==='Escape')clearSelection();}}><div className={styles.panelTitle} data-card-drag={floatingCompany||undefined} tabIndex={floatingCompany?0:undefined} aria-label={floatingCompany?(chinese?"移动公司卡片":"Move company card"):undefined}><strong>{event?ui('Selected event'):company?companyName(company,locale):''}</strong><button aria-label={floatingCompany?"Close company details":"Close selected sources"} onClick={clearSelection}>×</button></div>{event?<><p>{event.summary}</p><div className={liveStyles.dates}><UiText text={"Published"}/>{' '}{event.published_at?new Date(event.published_at).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':event.publication_date+' ('+ui('date only')+')'}{event.eventDate&&<><br/><UiText text={"Business / filing date"}/>{' '}{event.eventDate}</>}</div><nav aria-label="Primary sources" className={liveStyles.evidenceLinks}>{event.evidence.map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.channel} · {source.title} ↗<small>{source.sourceDate?ui('Published')+' '+source.sourceDate:ui('Publication date unavailable')}</small></a>)}</nav></>:<p>{(company&&companySummary(company,locale))||(chinese?'查看该公司已公开的关系来源。':'Explore the company’s published relationship sources.')}<button className={styles.saveButton} onClick={event=>void toggleSaved(selected,event)}><UiText text={saved.includes(selected)?'★ Saved':'☆ Save company'}/></button></p>}<IntelligencePricePerformance price={company?.dailyPrice} returns={event?snapshot.eventReturns?.[event.id]:undefined} symbol={label}/><h2><UiText text={"Relationships"}/></h2><div className={styles.researchPaths}>{connections.map(edge=><button key={edge.id} aria-pressed={edgeId===edge.id} onClick={()=>{setEdgeId(edge.id);setSelected(edge.source);setCamera(value=>value+1);}}><span>{label(edge.source)} <i>→</i> {label(edge.target)}</span><small>{relationshipSummary(edge,locale)}</small></button>)}{!connections.length&&<p><UiText text={"No documented relationship paths for this signal."}/></p>}</div>{!event&&company&&<nav aria-label={ui("Relationship sources")} className={liveStyles.evidenceLinks}><Link href={researchCompanyUrl(company)}><UiText text={"Relationship sources ↗"}/></Link>{graph.sources.filter(source=>connections.some(edge=>edge.sourceIds.includes(source.id))||(theme!=='ai'&&company.sourceIds?.includes(source.id))).slice(0,8).map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{relationshipSourceTitle(source,locale)} ↗</a>)}</nav>}{!event&&company&&<GraphCompanyOutlook company={company}/>}<p className={styles.evidenceNote}><UiText text={"Source activity and research relevance do not indicate price direction or verify that an announced plan has been delivered."}/></p></section>:null;

  return <main onClickCapture={event=>{if((event.target as Element).closest('[data-node-card]'))return;const r=(event.target as Element).getBoundingClientRect();clickAnchor.current=event.detail?{x:event.clientX,y:event.clientY}:{x:r.right,y:r.bottom};}} className={`${styles.shell} ${leftOpen?'':styles.leftClosed} ${rightOpen?'':styles.rightClosed}`}>
    <h1 className={styles.srOnly}><UiText text="Investment Intelligence"/></h1>
    <aside className={styles.left} aria-label="Universe navigation" data-filtered={Boolean(query)||tab==='watchlist'||activeOnly||Boolean(sourceFilter)}>
      <div className={styles.panelTitle}><strong><UiText text={"Explore universe"}/></strong><button aria-label="Collapse left panel" onClick={()=>setLeftOpen(false)}>‹</button></div>
      <label className={styles.search}><span className={styles.srOnly}><UiText text={"Search companies"}/></span><input disabled={switching} value={query} onChange={change=>{setQuery(change.target.value);clearSelection();}} placeholder={ui('Search company / ticker')}/></label>
      <div className={styles.sectionLabel}><UiText text={"INVESTMENT THEME"}/></div><IntelligenceThemeSelector theme={requestedTheme} onChange={changeTheme} count={switching?undefined:allCompanies.length}/>
      <div className={liveStyles.themeFilters} inert={switching}>
      <div className={styles.sectionLabel}><UiText text={"SECTORS"}/>{' '}<button aria-label="Clear sector focus" onClick={()=>{setSector('');clearSelection();}}><UiText text={"All"}/></button></div>
      <div className={styles.sectors}>{sectors.map(item=><button key={item.id} aria-pressed={sector===item.id} onClick={()=>{setSector(sector===item.id?'':item.id);clearSelection();setCamera(value=>value+1);}}><span style={{background:item.color}}/>{chinese?item.zh:item.en}<small>{allCompanies.filter(node=>matchesCompanySector(node,item.id)).length}</small></button>)}</div>
      {theme==='ai'&&<nav className={controls.researchShortcuts} aria-label="Research shortcuts"><div className={controls.researchHeading}><UiText text={"RESEARCH"}/>{' '}<Link href="/research"><UiText text={"All ↗"}/></Link></div><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA suppliers & ecosystem ↗"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD deployments & ecosystem ↗"}/></Link><button onClick={()=>{setSector('infrastructure');clearSelection();setCamera(value=>value+1);}}><UiText text={"AI infrastructure bottlenecks →"}/></button></nav>}
      <div className={styles.listTabs}><button aria-pressed={tab==='all'} onClick={()=>{setTab('all');clearSelection();}}><UiText text={"Companies"}/></button><button aria-pressed={tab==='watchlist'} onClick={()=>{setTab('watchlist');clearSelection();}}><UiText text={"Watchlist"}/>{' '}<small>{saved.length}</small></button></div>
      <div className={styles.companyList}>{companies.map(node=><div key={node.id} className={selected===node.id?styles.selectedCompany:undefined}><button onClick={()=>focusCompany(node.id)}><strong>{node.symbol||node.name}</strong><span>{companyName(node,locale)}</span></button><CompanyFollowStar confirmation={false} key={`${node.id}:${follows.user?.uid??'guest'}`} label={node.symbol||node.name||node.id} followed={saved.includes(node.id)} disabled={follows.loading||Boolean(follows.user)&&!follows.ready} onChange={(follow,anchor)=>changeSaved(node.id,follow,anchor)}/></div>)}{!companies.length&&<p className={styles.empty}><UiText text={"No matching companies."}/></p>}</div>
      <div className={styles.leftFoot}><UiText text={saveError||(!follows.user&&saved.length?'Session watchlist · sign in to persist':'Company universe with published sources')}/></div>
      </div>
    </aside>
    <section className={styles.center} aria-label="Graph universe">
      <div className={styles.graphToolbar}><div>{!leftOpen&&<button aria-label="Expand left panel" onClick={()=>setLeftOpen(true)}><UiText text={"☰ Explore"}/></button>}{!leftOpen&&<IntelligenceThemeSelector compact theme={requestedTheme} onChange={changeTheme}/>}<IntelligenceViewTabs view={view} onChange={changeView} id={viewId}/></div><div><div className={controls.liveControls}><IntelligencePriceAsOf nodes={allCompanies}/><span className={controls.liveStatus}>{error&&<UiText text="Disconnected"/>}<small>{clock(until)}{' '}<UiText text="ET"/></small></span></div>{(view==='graph'||view==='tree')&&<NavigationSettings compact/>}<button disabled={switching} aria-label="Reset universe view" onClick={()=>{clearSelection();setSector('');setSourceFilter('');setActiveOnly(false);setReset(value=>value+1);}}><UiText text={"Reset ⤢"}/></button>{!rightOpen&&<button onClick={()=>setRightOpen(true)}><UiText text={"Events ›"}/></button>}</div></div>
      {error&&!switching&&<div className={liveStyles.notice} role="alert"><UiText text={"Connection interrupted. Showing the last received data."}/>{' '}<button onClick={reconnect}><UiText text={"Retry"}/></button></div>}
      <div className={viewStyles.panel} role="tabpanel" id={`${viewId}-panel`} aria-labelledby={`${viewId}-${view}`} tabIndex={0}>
        {/* Keep the old scene while loading; initialize camera, growth and branch state for the committed theme. */}
        <div className={liveStyles.themeContents} data-company-workspace inert={switching} aria-busy={switching&&!error}>
        {view==='graph'?<div className={styles.graph} data-view="graph" style={{height:"100%"}}><Suspense fallback={<p className={styles.loading} role="status"><UiText text={"Loading universe…"}/></p>}><Universe key={theme} graph={graph} selected={selected} onSelect={focusCompany} sectorFocus={theme!=='ai'?'':sector} cameraRequest={camera} reset={reset} onReset={()=>setReset(value=>value+1)} intelligence={intelligence} companyFocus={filteredCompanyIds} activeEdge={edgeId} onSelectEdge={setEdgeId} hideReset/></Suspense><IntelligenceSectorLegend theme={theme}/>{event&&<div className={styles.eventOverlay} onPointerDown={pointer=>pointer.stopPropagation()} onClick={click=>click.stopPropagation()}><span className={styles.sectionLabel}>{event.category} · {event.published_at?clock(Date.parse(event.published_at))+' ET':event.publication_date}</span><strong>{eventSource?<a href={eventSource.url} target="_blank" rel="noopener noreferrer">{event.title} ↗</a>:event.title}</strong><IntelligencePricePerformance returns={snapshot.eventReturns?.[event.id]} symbol={label} compact/><span>{connections.length}{' '}<UiText text={"documented research paths"}/></span></div>}</div>:<Suspense fallback={<p className={styles.loading} role="status"><UiText text={"Loading universe…"}/></p>}>
          {view==='tree'?<Tree key={`${theme}:${reset}`} embedded vertical companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved} active showCard={false}/>:view==='hierarchy'?<Hierarchy key={`${theme}:${reset}`} embedded companies={companies} selected={selected} onSelect={focusCompany} closing={false}/>:<div className={viewStyles.table}><CompanyTable companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved}/></div>}
        </Suspense>}
        {floatingCompany&&selectedDetails}
        </div>
        {switching&&<div className={liveStyles.themeProgress} role={error?'alert':'status'} aria-live="polite">
          {!error&&<span className={liveStyles.themeSpinner} aria-hidden="true"/>}
          <span>{error?(chinese?`无法加载${requestedName}。仍显示${name}。`:`Could not load ${requestedName}. Still showing ${name}.`):(chinese?`正在加载${requestedName}…`:`Loading ${requestedName}…`)}</span>
          {error&&<button onClick={reconnect}><UiText text="Retry"/></button>}
          <button onClick={()=>changeTheme(theme)}><UiText text="Cancel"/></button>
        </div>}
      </div>
      <section className={summaryStyles.summary} aria-label="Theme activity summary" inert={switching}><div className={summaryStyles.period} role="group" aria-label={chinese?'活动统计时间范围':'Activity period'}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection();}}>{ui('Today')}</button><button aria-pressed={window==='recent'} title={ui('Last 30 days')} onClick={()=>{setWindow('recent');clearSelection();}}>30d</button></div><span className={summaryStyles.context} title={chinese?'统计涵盖当前时段已收录的来源文档。':'Totals cover recorded source documents in the selected period.'}>{name}{!snapshot.statisticsComplete&&(chinese?' · 部分数据':' · Partial')}{(!snapshot.statisticsComplete||snapshot.warnings.length>0)&&<span role="img" aria-label={ui('partial coverage')} title={ui('partial coverage')}> · ◐</span>}</span>{snapshot.newsCoverage&&<span className={summaryStyles.context} title={`${snapshot.newsCoverage.healthy} / ${snapshot.newsCoverage.configured} ${chinese?'采集器正常':'collectors healthy'}`} aria-label={chinese?'公司新闻采集覆盖':'Company news collector coverage'}>{chinese?'新闻':'News'} {snapshot.newsCoverage.configured}/{snapshot.newsCoverage.total}</span>}<button aria-label="Filter to active companies" aria-pressed={activeOnly} onClick={()=>{setActiveOnly(value=>!value);showEvents();}}><span><UiText text={"Active companies"}/></span><strong>{activity.activeIds.length} / {scope.length}</strong><ActiveCompanyMeter active={activity.activeIds.length} total={scope.length}/></button><button onClick={showEvents} aria-controls="intelligence-event-stream"><span><UiText text={"Source documents"}/></span><strong>{activity.signals}</strong><PublicationActivity events={activity.documents} start={window==='today'?start:until-30*86_400_000} end={until} label={ui('Activity by source publication time')}/></button><div className={summaryStyles.sources}><span><UiText text={"Sources"}/></span>{sourceActivity.map(source=>{const available=snapshot.coverage.find(item=>item.channel===source.name)?.status!=='unavailable';return <button key={source.name} aria-label={`Filter ${source.name} signals`} aria-pressed={sourceFilter===source.name} disabled={!available} title={available?'Recorded source documents':'Source not connected'} onClick={()=>{setSourceFilter(sourceFilter===source.name?'':source.name);showEvents();}}>{source.name==='Exchange'?(chinese?'交易所公告':'Exchange filings'):source.name}<strong>{available?source.count:'—'}</strong><SourceVolume source={source.name} count={source.count} max={Math.max(0,...sourceActivity.map(item=>item.count))} available={available}/></button>;})}</div>{(activeOnly||sourceFilter)&&<button className={summaryStyles.clear} onClick={()=>{setActiveOnly(false);setSourceFilter('');showEvents();}}><UiText text={"Clear activity filters"}/></button>}</section>
    </section>
    <aside className={`${styles.right} ${liveStyles.rightPanel}`} aria-label="Events and sources" inert={switching}><div className={styles.panelTitle}><strong><UiText text={"What’s moving the universe"}/></strong><button aria-label="Collapse right panel" onClick={()=>setRightOpen(false)}>›</button></div><div className={liveStyles.windowControls}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection();}}><UiText text={"Today"}/></button><button aria-pressed={window==='recent'} onClick={()=>{setWindow('recent');clearSelection();}}>{chinese?'近 30 天':'30d'}</button></div>{!floatingCompany&&selectedDetails}<div className={liveStyles.rightBody}><div className={styles.eventSummary}><span>{loadedActivity.signals}{' '}{chinese?'份已加载来源文档':'loaded source documents'}</span><span><UiText text={"Updated ·"}/>{' '}{clock(until)}{' '}<UiText text={"ET"}/></span></div>{recentFallback&&<p className={styles.empty}><UiText text={"No new events in the available records today."}/><button onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"View recent events →"}/></button></p>}<IntelligenceActivityOverview events={overviewEvents} documents={activity.documents} complete={snapshot.statisticsComplete} companies={scope} recentFallback={false} period={window==='recent'?'recent':'today'} sourceFilter={sourceFilter} limit={snapshot.limit} truncated={snapshot.truncated} onSector={id=>{if(recentFallback)setWindow('recent');setSector(id);clearSelection();setCamera(value=>value+1);}} onSource={source=>{if(recentFallback)setWindow('recent');setSourceFilter(source);clearSelection();}} onEvent={id=>{setWindow('recent');activate(id);}}/><div id="intelligence-event-stream" className={styles.eventList}>{events.map(item=><div key={item.id} className={liveStyles.eventRow} data-calendar={Boolean(item.calendarEvents?.length)}><button aria-pressed={eventId===item.id} onClick={()=>{activate(item.id);}}><div><span><UiText text={item.category}/></span>{item.published_at?<RelativeTime value={item.published_at} interactive={false}/>:<time dateTime={item.published_at??item.publication_date}>{item.published_at?(item.publication_date===snapshot.session.date?'':shortDate(item.publication_date)+' ')+clock(Date.parse(item.published_at)):shortDate(item.publication_date)+' · '+ui('date only')}</time>}</div><strong title={intelligenceEventTitle(item,locale)!==item.title?item.title:undefined}>{intelligenceEventTitle(item,locale)}</strong><IntelligenceEventCompanies companyIds={item.companyIds} companies={companiesById} chinese={chinese}/><small><UiText text={item.planned?'announced plan':''}/><span>↗</span></small></button><IntelligenceCalendarLinks events={item.calendarEvents}/></div>)}{!events.length&&!recentFallback&&<p className={styles.empty}>{activity.signals>0?(chinese?`匹配的来源未包含在最新 ${snapshot.limit} 条列表中，但已计入统计。`:`Matching sources are outside the latest ${snapshot.limit} entries shown, but are included in the totals.`):<UiText text={window==='today'?'No new events in the available records today.':'No recorded events match these filters.'}/>} {window==='today'&&activity.signals===0&&<button onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"View recent events →"}/></button>}</p>}</div>

      </div><details className={styles.rightFoot}><summary>{chinese?'来源状态':'Source status'}{(!snapshot.statisticsComplete||snapshot.warnings.length>0)?' · ◐':''}</summary><p><UiText text={"Counts deduplicate source documents."}/></p>{snapshot.truncated&&<p>{chinese?`列表显示最新 ${snapshot.limit} 条；统计独立于列表上限。`:`The list shows the latest ${snapshot.limit} entries; totals are independent of the list limit.`}</p>}{snapshot.newsCoverage&&<p>{chinese?'公司新闻覆盖':'Company news coverage'} {snapshot.newsCoverage.configured}/{snapshot.newsCoverage.total} · {snapshot.newsCoverage.healthy} {chinese?'正常':'healthy'}</p>}{snapshot.warnings.map(warning=><p key={warning}><UiText text={warning}/></p>)}</details>
    </aside>
    {followConfirmation&&<CompanyFollowConfirmation key={followConfirmation.id} label={followConfirmation.label} followed={followConfirmation.followed} anchor={followConfirmation.anchor}/>}
  </main>;
}
