"use client";

import { LoadingSpinner } from './loading-spinner';
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
import { IntelligencePricePerformance, IntelligenceEventPriceReturns } from './intelligence-price-performance';
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
import { intelligenceEventTitle, intelligenceEventMatchesId, sourceDocumentsForEvents, summarizeSourceDocuments, summarizeIntelligence, sourceChannel, type IntelligenceEvent, type IntelligenceSnapshot, type IntelligenceSource } from '@/lib/intelligence/model';
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
const subscribePhone=(notify:()=>void)=>{const media=matchMedia('(max-width:767px)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
const phoneWidth=()=>matchMedia('(max-width:767px)').matches;
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
  const phone=useSyncExternalStore(subscribePhone,phoneWidth,()=>true);
  const defaultView=initialEdge||initialEvent?'graph':phone?'table':'graph';
  const view=parseIndustryView(useIndustryBrowseParam('view',defaultView,initialView||defaultView))??defaultView;
  const viewId=useId();
  const changeView=(next:IndustryView)=>{updateIndustryBrowse({view:next});};
  const [sourceFilter,setSourceFilter]=useState<IntelligenceSource|''>(''),[activeOnly,setActiveOnly]=useState(false);
  const requestedRegion=useIndustryBrowseParam('region');
  const region=requestedRegion==='US'||requestedRegion==='CN_A'?requestedRegion:'';
  const eventsPending=Boolean(snapshot.eventsPending);
  const defaultPeriod=()=>(snapshot.sourceDocuments??sourceDocumentsForEvents(snapshot.events)).some(document=>document.publication_date===snapshot.session.date)?'today' as const:'recent' as const;
  const [period,setPeriod]=useState(()=>({value:eventsPending?'today' as const:defaultPeriod(),pending:eventsPending}));
  if(period.pending&&!eventsPending)setPeriod({value:defaultPeriod(),pending:false});
  const window=period.value;
  const setWindow=(value:'today'|'recent')=>setPeriod({value,pending:false});
  const pendingEvents=<p className={styles.loading} role={error?'alert':'status'}>{!error&&<LoadingSpinner/>}{error?(chinese?'无法加载事件。':'Could not load events.'):(chinese?'正在加载事件和来源…':'Loading events and sources…')}{error&&<button onClick={reconnect}><UiText text="Retry"/></button>}</p>;
  const selectedPanel=useRef<HTMLElement>(null);
  const requestedCompany=useIndustryBrowseParam('company','',initialCompany);
  const eventId=useIndustryBrowseParam('event','',initialEvent),edgeId=useIndustryBrowseParam('relationship','',initialEdge);
  const requestedFeedCompany=useIndustryBrowseParam('feedCompany');
  const setSelected=(company:string)=>updateIndustryBrowse({company});
  const setEdgeId=(relationship:string)=>updateIndustryBrowse({relationship});
  const requestedId=requestedCompany.includes(':')?requestedCompany.toUpperCase():requestedCompany?`US:${requestedCompany.toUpperCase()}`:'';
  const linkedEvent=theme==='ai'?curatedEvents.find(item=>item.id===eventId):undefined;
  const selected=requestedId||snapshot.events.find(item=>intelligenceEventMatchesId(item,eventId))?.origin||linkedEvent?.companyIds[0]||snapshot.graph.relationships.find(item=>item.id===edgeId)?.source||'';
  const [camera,setCamera]=useState(0),[reset,setReset]=useState(0),[pulse,setPulse]=useState(0);
  const [propagating,setPropagating]=useState(false);
  const start=Date.parse(snapshot.session.startAt),until=Date.parse(snapshot.generatedAt);
  const graph=useMemo(()=>{
    if(!region)return snapshot.graph;
    const nodes=snapshot.graph.nodes.filter(node=>node.kind!=='COMPANY'||(region==='US'?node.id.startsWith('US:'):/^(XSHG:|XSHE:)/.test(node.id)));
    const ids=new Set(nodes.map(node=>node.id));
    return {...snapshot.graph,nodes,relationships:snapshot.graph.relationships.filter(edge=>ids.has(edge.source)&&ids.has(edge.target))};
  },[snapshot.graph,region]);
  const allCompanies=useMemo(()=>graph.nodes.filter(node=>node.kind==='COMPANY'),[graph]);
  const companiesById=useMemo(()=>new Map(allCompanies.map(company=>[company.id,company])),[allCompanies]);
  const newsCoverage=useMemo(()=>{
    const coverage=snapshot.newsCoverage;if(!coverage||!region)return coverage;
    if(!coverage.companyIds||!coverage.configuredCompanyIds||!coverage.healthyCompanyIds)return undefined;
    const ids=coverage.companyIds.filter(id=>companiesById.has(id));
    if(!ids.length)return undefined;
    return {total:ids.length,configured:ids.filter(id=>coverage.configuredCompanyIds!.includes(id)).length,healthy:ids.filter(id=>coverage.healthyCompanyIds!.includes(id)).length};
  },[snapshot.newsCoverage,region,companiesById]);
  // Known company IDs distinguish an empty regional coverage set from missing metadata.
  const canScopeNewsCoverage=Boolean(snapshot.newsCoverage?.companyIds&&snapshot.newsCoverage.configuredCompanyIds&&snapshot.newsCoverage.healthyCompanyIds);
  const warnings=snapshot.warnings.filter(warning=>!region||!canScopeNewsCoverage||(!warning.startsWith('Verified IR/news feeds cover ')&&!warning.startsWith('Company news collector freshness is unverified: ')));
  const partialCoverage=!snapshot.statisticsComplete||warnings.length>0||Boolean(newsCoverage&&(newsCoverage.configured<newsCoverage.total||newsCoverage.healthy<newsCoverage.configured));
  const scope=useMemo(()=>{
    const search=query.normalize('NFKC').trim().replace(/^\$/,'');
    const exact=search?allCompanies.filter(node=>companySearchRank(node,search)===0):[];
    const candidates=exact.length?exact:allCompanies;
    return candidates.filter(node=>(!sector||matchesCompanySector(node,sector))&&(!search||exact.length>0||matchesCompanySearch(companySearchText(graph,node),search))&&(tab!=='watchlist'||saved.includes(node.id))).sort((a,b)=>search?companySearchRank(a,search)-companySearchRank(b,search):0);
  },[allCompanies,graph,sector,query,tab,saved]);
  const feedCompanyId=requestedFeedCompany.toUpperCase()||(!eventId&&!edgeId?requestedId:'');
  const activityCompany=companiesById.get(feedCompanyId);
  const activityScope=activityCompany?[activityCompany]:scope;
  const inWindow=snapshot.events.filter(event=>window==='recent'||event.publication_date===snapshot.session.date);
  const scopeIds=scope.map(node=>node.id);
  const activityIds=activityScope.map(node=>node.id);
  const sourceDocuments=snapshot.sourceDocuments??sourceDocumentsForEvents(snapshot.events);
  const periodDocuments=sourceDocuments.filter(document=>window==='recent'||document.publication_date===snapshot.session.date);
  const loadedActivity=summarizeIntelligence(inWindow,activityIds,sourceFilter);
  const activity={...loadedActivity,...summarizeSourceDocuments(periodDocuments,activityIds,sourceFilter)};
  const sourceActivity=summarizeSourceDocuments(periodDocuments,activityIds,'').sources.filter(source=>snapshot.coverage.some(item=>item.channel===source.name&&item.status!=='unavailable')&&(source.name!=='Other'||source.count>0));
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
  const candidateEvent=snapshot.events.find(item=>intelligenceEventMatchesId(item,eventId))??editorialEvent;
  const event=candidateEvent?.companyIds.some(id=>companiesById.has(id))?candidateEvent:undefined;
  const clickAnchor=useRef<{x:number;y:number}|null>(null);
  const [companyAnchor,setCompanyAnchor]=useState<{x:number;y:number}|null>(null);
  const floatingCompany=Boolean(company||event);
  const companyCard=useNodeCardPosition(selected,'workspace',floatingCompany,companyAnchor,'top-right',eventId||selected);
  const sourceTitle=(source:IntelligenceEvent['evidence'][number])=>event&&source.title===event.title?intelligenceEventTitle(event,locale):source.title;
  const eventSource=event?.evidence.find(source=>source.channel==='SEC')??event?.evidence[0];
  const connections=graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(event?event.edgeIds.includes(edge.id):selected&&(edge.source===selected||edge.target===selected)));
  const intelligence={origin:propagating?event?.origin??'':'',edges:event?propagating?event.edgeIds:[]:selected?graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(edge.source===selected||edge.target===selected)).map(edge=>edge.id):[]};
  const filteredCompanyIds=activeOnly||sourceFilter?activity.activeIds:query||tab==='watchlist'||(theme!=='ai'&&sector)?scopeIds:undefined;
  const label=(id:string)=>{const node=companiesById.get(id);return node?.symbol||node?.name||id;};

  function clearSelection(preserveCompany=false){const company=preserveCompany?activityCompany?.id??'':'';updateIndustryBrowse({company,feedCompany:company,event:'',relationship:''});setPropagating(false);}
  function showEvents(){setRightOpen(true);clearSelection(true);}
  function focusCompany(id:string){if(!id||id===selected&&!eventId&&!edgeId){clearSelection();return;}clearSelection();setCompanyAnchor(clickAnchor.current);updateIndustryBrowse({company:id,feedCompany:id});setCamera(value=>value+1);}
  function activate(id:string){const next=snapshot.events.find(item=>intelligenceEventMatchesId(item,id));if(!next)return;const company=activityCompany&&next.companyIds.includes(activityCompany.id)?activityCompany.id:companiesById.has(next.origin)?next.origin:next.companyIds.find(id=>companiesById.has(id))??'';setRightOpen(true);updateIndustryBrowse({event:id,company,relationship:'',feedCompany:activityCompany?.id??''});setCamera(value=>value+1);setPropagating(true);setPulse(value=>value+1);}
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
  useEffect(()=>{
    if(phone&&eventId)companyCard.current?.closest('[data-company-workspace]')?.scrollIntoView({block:'start'});
    if(selected||eventId)(floatingCompany?companyCard:selectedPanel).current?.focus({preventScroll:true});
  },[selected,eventId,floatingCompany,companyCard,phone]);
  useEffect(()=>{if(!propagating)return;const timer=setTimeout(()=>setPropagating(false),20_000);return()=>clearTimeout(timer);},[propagating,pulse]);

  // Reset theme-specific filters before committing the new contents, keeping the workspace mounted.
  if(appliedTheme!==theme){setAppliedTheme(theme);setSector('');setTab('all');setSourceFilter('');setActiveOnly(false);setPropagating(false);}

  const selectedDetails=(event||company)?<section ref={floatingCompany?companyCard:selectedPanel} tabIndex={-1} aria-label={floatingCompany?ui('Company details'):ui('Selected sources')} className={`${styles.evidence} ${liveStyles.selectedPanel} ${floatingCompany?liveStyles.companyCard:""}`} onKeyDown={key=>{if(key.key==='Escape')clearSelection();}}><div className={styles.panelTitle} data-card-drag={floatingCompany||undefined} tabIndex={floatingCompany?0:undefined} aria-label={floatingCompany?(chinese?"移动公司卡片":"Move company card"):undefined}><strong>{company?companyName(company,locale):ui('Selected event')}</strong><button aria-label={floatingCompany?"Close company details":"Close selected sources"} onClick={()=>clearSelection()}>×</button></div>{event?<><h2><UiText text="Selected event"/></h2><p><strong>{eventSource?<a href={eventSource.url} title={intelligenceEventTitle(event,locale)!==event.title?event.title:undefined} target="_blank" rel="noopener noreferrer">{intelligenceEventTitle(event,locale)} ↗</a>:intelligenceEventTitle(event,locale)}</strong></p><p>{event.summary==='交易所上市公司原始公告。'?(chinese?event.summary:'Original announcement from an exchange-listed company.'):event.summary}</p><div className={liveStyles.dates}><UiText text={"Published"}/>{' '}{event.published_at?new Date(event.published_at).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':event.publication_date+' ('+ui('date only')+')'}{event.eventDate&&<><br/><UiText text={"Business / filing date"}/>{' '}{event.eventDate}</>}</div><nav aria-label="Primary sources" className={liveStyles.evidenceLinks}>{event.evidence.map(source=><a key={source.id} href={source.url} title={sourceTitle(source)!==source.title?source.title:undefined} target="_blank" rel="noopener noreferrer">{source.channel} · {sourceTitle(source)} ↗<small>{source.sourceDate?ui('Published')+' '+source.sourceDate:ui('Publication date unavailable')}</small></a>)}</nav></>:<p>{(company&&companySummary(company,locale))||(chinese?'查看该公司已公开的关系来源。':'Explore the company’s published relationship sources.')}<button className={styles.saveButton} onClick={event=>void toggleSaved(selected,event)}><UiText text={saved.includes(selected)?'★ Saved':'☆ Save company'}/></button></p>}{eventsPending?<p role={error?'alert':'status'}>{!error&&<LoadingSpinner/>}{error?(chinese?'无法加载价格。':'Could not load prices.'):(chinese?'正在加载价格…':'Loading prices…')}</p>:<IntelligencePricePerformance price={company?.dailyPrice} returns={event?snapshot.eventReturns?.[event.id]?.filter(value=>companiesById.has(value.companyId)&&(!activityCompany||value.companyId===activityCompany.id)):undefined} symbol={label}/>}<h2><UiText text={"Relationships"}/></h2><div className={styles.researchPaths}>{connections.map(edge=><button key={edge.id} aria-pressed={edgeId===edge.id} onClick={()=>{setEdgeId(edge.id);setSelected(edge.source);setCamera(value=>value+1);}}><span>{label(edge.source)} <i>→</i> {label(edge.target)}</span><small>{relationshipSummary(edge,locale)}</small></button>)}{!connections.length&&<p><UiText text={"No documented relationship paths for this signal."}/></p>}</div>{!event&&company&&<nav aria-label={ui("Relationship sources")} className={liveStyles.evidenceLinks}><Link href={researchCompanyUrl(company)}><UiText text={"Relationship sources ↗"}/></Link>{graph.sources.filter(source=>connections.some(edge=>edge.sourceIds.includes(source.id))||(theme!=='ai'&&company.sourceIds?.includes(source.id))).slice(0,8).map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{relationshipSourceTitle(source,locale)} ↗</a>)}</nav>}{company&&<GraphCompanyOutlook company={company}/>}<p className={styles.evidenceNote}><UiText text={"Source activity and research relevance do not indicate price direction or verify that an announced plan has been delivered."}/></p></section>:null;

  return <main onClickCapture={event=>{if((event.target as Element).closest('[data-node-card]'))return;const r=(event.target as Element).getBoundingClientRect();clickAnchor.current=event.detail?{x:event.clientX,y:event.clientY}:{x:r.right,y:r.bottom};}} className={`${styles.shell} ${liveStyles.regionWorkspace} ${leftOpen?'':styles.leftClosed} ${rightOpen?'':styles.rightClosed}`}>
    <h1 className={styles.srOnly}><UiText text="Investment Intelligence"/></h1>
    <aside className={styles.left} aria-label="Universe navigation" data-filtered={Boolean(region)||Boolean(query)||tab==='watchlist'||activeOnly||Boolean(sourceFilter)}>
      <div className={styles.panelTitle}><strong><UiText text={"Explore universe"}/></strong><button aria-label="Collapse left panel" onClick={()=>setLeftOpen(false)}>‹</button></div>
      <label className={styles.search}><span className={styles.srOnly}><UiText text={"Search companies"}/></span><input disabled={switching} value={query} onChange={change=>{setQuery(change.target.value);clearSelection();}} placeholder={ui('Search company / ticker')}/></label>
      <div className={liveStyles.browseSelectors}><div><div className={liveStyles.selectorLabel}><UiText text="INVESTMENT THEME"/></div><IntelligenceThemeSelector theme={requestedTheme} onChange={changeTheme} count={switching?undefined:allCompanies.length}/></div><label className={liveStyles.regionFilter}><span className={liveStyles.selectorLabel}>{chinese?'地区':'REGION'}</span><select aria-label={chinese?'地区':'Region'} disabled={switching} data-filtered={Boolean(region)} value={region} onChange={change=>{updateIndustryBrowse({region:change.target.value},true);clearSelection();setReset(value=>value+1);}}><option value="">{chinese?'全部':'All'}</option><option value="US">{chinese?'美股':'US stocks'}</option><option value="CN_A">{chinese?'中国 A 股':'China A-shares'}</option></select></label></div>
      <div className={liveStyles.themeFilters} inert={switching}>
      <div className={styles.sectionLabel}><UiText text={"SECTORS"}/>{' '}<button aria-label="Clear sector focus" onClick={()=>{setSector('');clearSelection();}}><UiText text={"All"}/></button></div>
      <div className={styles.sectors}>{sectors.map(item=><button key={item.id} aria-pressed={sector===item.id} onClick={()=>{setSector(sector===item.id?'':item.id);clearSelection();setCamera(value=>value+1);}}><span style={{background:item.color}}/>{chinese?item.zh:item.en}<small>{allCompanies.filter(node=>matchesCompanySector(node,item.id)).length}</small></button>)}</div>
      {theme==='ai'&&<nav className={controls.researchShortcuts} aria-label="Research shortcuts"><div className={controls.researchHeading}><UiText text={"RESEARCH"}/>{' '}<Link href="/research"><UiText text={"All ↗"}/></Link></div><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA suppliers & ecosystem ↗"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD deployments & ecosystem ↗"}/></Link><button onClick={()=>{setSector('infrastructure');clearSelection();setCamera(value=>value+1);}}><UiText text={"AI infrastructure bottlenecks →"}/></button></nav>}
      <div className={styles.listTabs}><button aria-pressed={tab==='all'} onClick={()=>{setTab('all');clearSelection();}}><UiText text={"Companies"}/></button><button aria-pressed={tab==='watchlist'} onClick={()=>{setTab('watchlist');clearSelection();}}><UiText text={"Watchlist"}/>{' '}<small>{saved.length}</small></button></div>
      <div className={styles.companyList}>{companies.map(node=><div key={node.id} className={selected===node.id?styles.selectedCompany:undefined}><button aria-pressed={selected===node.id} onClick={()=>focusCompany(node.id)}><strong>{node.symbol||node.name}</strong><span>{companyName(node,locale)}</span></button><CompanyFollowStar confirmation={false} key={`${node.id}:${follows.user?.uid??'guest'}`} label={node.symbol||node.name||node.id} followed={saved.includes(node.id)} disabled={follows.loading||Boolean(follows.user)&&!follows.ready} onChange={(follow,anchor)=>changeSaved(node.id,follow,anchor)}/></div>)}{!companies.length&&<p className={styles.empty}><UiText text={"No matching companies."}/></p>}</div>
      <div className={styles.leftFoot}><UiText text={saveError||(!follows.user&&saved.length?'Session watchlist · sign in to persist':'Company universe with published sources')}/></div>
      </div>
    </aside>
    <section className={styles.center} aria-label="Graph universe">
      <div className={styles.graphToolbar}><div>{!leftOpen&&<button aria-label="Expand left panel" onClick={()=>setLeftOpen(true)}><UiText text={"☰ Explore"}/></button>}{!leftOpen&&<IntelligenceThemeSelector compact theme={requestedTheme} onChange={changeTheme}/>}<IntelligenceViewTabs view={view} onChange={changeView} id={viewId}/></div><div><div className={controls.liveControls}><IntelligencePriceAsOf nodes={allCompanies}/><span className={controls.liveStatus}>{error&&<UiText text="Disconnected"/>}<small>{clock(until)}{' '}<UiText text="ET"/></small></span></div>{(view==='graph'||view==='tree')&&<NavigationSettings compact/>}<button disabled={switching} aria-label="Reset universe view" onClick={()=>{clearSelection();setSector('');setSourceFilter('');setActiveOnly(false);setReset(value=>value+1);}}><UiText text={"Reset ⤢"}/></button>{!rightOpen&&<button onClick={()=>setRightOpen(true)}><UiText text={"Events ›"}/></button>}</div></div>
      {error&&!switching&&<div className={liveStyles.notice} role="alert"><UiText text={"Connection interrupted. Showing the last received data."}/>{' '}<button onClick={reconnect}><UiText text={"Retry"}/></button></div>}
      <div className={viewStyles.panel} role="tabpanel" id={`${viewId}-panel`} aria-labelledby={`${viewId}-${view}`} tabIndex={0}>
        {/* Keep the old scene while loading; initialize camera, growth and branch state for the committed theme. */}
        <div className={liveStyles.themeContents} data-company-workspace inert={switching} aria-busy={switching&&!error}>
        {view==='graph'?<div className={styles.graph} data-view="graph" style={{height:"100%"}}><Suspense fallback={<p className={styles.loading} role="status"><LoadingSpinner/><UiText text={"Loading universe…"}/></p>}><Universe key={theme} graph={graph} selected={selected} onSelect={focusCompany} sectorFocus={theme!=='ai'?'':sector} cameraRequest={camera} reset={reset} onReset={()=>setReset(value=>value+1)} intelligence={intelligence} companyFocus={filteredCompanyIds} activeEdge={edgeId} onSelectEdge={setEdgeId} hideReset/></Suspense><IntelligenceSectorLegend theme={theme}/></div>:<Suspense fallback={<p className={styles.loading} role="status"><LoadingSpinner/><UiText text={"Loading universe…"}/></p>}>
          {view==='tree'?<Tree key={`${theme}:${reset}`} embedded vertical companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved} active showCard={false}/>:view==='hierarchy'?<Hierarchy key={`${theme}:${reset}`} embedded companies={companies} selected={selected} onSelect={focusCompany} closing={false}/>:<div className={viewStyles.table}><CompanyTable companies={companies} selected={selected} onSelect={focusCompany} followedIds={saved}/></div>}
        </Suspense>}
        {floatingCompany&&selectedDetails}
        </div>
        {switching&&<div className={liveStyles.themeProgress} role={error?'alert':'status'} aria-live="polite">
          {!error&&<LoadingSpinner/>}
          <span>{error?(chinese?`无法加载${requestedName}。仍显示${name}。`:`Could not load ${requestedName}. Still showing ${name}.`):(chinese?`正在加载${requestedName}…`:`Loading ${requestedName}…`)}</span>
          {error&&<button onClick={reconnect}><UiText text="Retry"/></button>}
          <button onClick={()=>changeTheme(theme)}><UiText text="Cancel"/></button>
        </div>}
      </div>
      <section className={summaryStyles.summary} aria-label="Theme activity summary" inert={switching} aria-busy={eventsPending}>{eventsPending?pendingEvents:<><div className={summaryStyles.period} role="group" aria-label={chinese?'活动统计时间范围':'Activity period'}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection(true);}}>{ui('Today')}</button><button aria-pressed={window==='recent'} title={ui('Last 30 days')} onClick={()=>{setWindow('recent');clearSelection(true);}}>30d</button></div><span className={summaryStyles.context} title={chinese?'统计涵盖当前时段已收录的来源文档。':'Totals cover recorded source documents in the selected period.'}>{name}{!snapshot.statisticsComplete&&(chinese?' · 部分数据':' · Partial')}{partialCoverage&&<span role="img" aria-label={ui('partial coverage')} title={ui('partial coverage')}> · ◐</span>}</span>{newsCoverage&&<span className={summaryStyles.context} title={`${newsCoverage.healthy} / ${newsCoverage.configured} ${chinese?'采集器正常':'collectors healthy'}`} aria-label={chinese?'公司新闻采集覆盖':'Company news collector coverage'}>{chinese?'新闻':'News'} {newsCoverage.configured}/{newsCoverage.total}</span>}<button aria-label="Filter to active companies" aria-pressed={activeOnly} onClick={()=>{setActiveOnly(value=>!value);showEvents();}}><span><UiText text={"Active companies"}/></span><strong>{activity.activeIds.length} / {activityScope.length}</strong><ActiveCompanyMeter active={activity.activeIds.length} total={activityScope.length}/></button><button onClick={showEvents} aria-controls="intelligence-event-stream"><span><UiText text={"Source documents"}/></span><strong>{activity.signals}</strong><PublicationActivity events={activity.documents} start={window==='today'?start:until-30*86_400_000} end={until} label={ui('Activity by source publication time')}/></button><div className={summaryStyles.sources}><span><UiText text={"Sources"}/></span>{sourceActivity.map(source=>{const available=snapshot.coverage.find(item=>item.channel===source.name)?.status!=='unavailable';return <button key={source.name} aria-label={`Filter ${source.name} signals`} aria-pressed={sourceFilter===source.name} disabled={!available} title={available?'Recorded source documents':'Source not connected'} onClick={()=>{setSourceFilter(sourceFilter===source.name?'':source.name);showEvents();}}>{source.name==='Exchange'?(chinese?'交易所公告':'Exchange filings'):source.name}<strong>{available?source.count:'—'}</strong><SourceVolume source={source.name} count={source.count} max={Math.max(0,...sourceActivity.map(item=>item.count))} available={available}/></button>;})}</div>{(activeOnly||sourceFilter)&&<button className={summaryStyles.clear} onClick={()=>{setActiveOnly(false);setSourceFilter('');showEvents();}}><UiText text={"Clear activity filters"}/></button>}</>}</section>
    </section>
    <aside className={`${styles.right} ${liveStyles.rightPanel}`} aria-label="Events and sources" inert={switching}><div className={styles.panelTitle}><strong><UiText text={"What’s moving the universe"}/></strong><button aria-label="Collapse right panel" onClick={()=>setRightOpen(false)}>›</button></div><div className={liveStyles.windowControls}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection(true);}}><UiText text={"Today"}/></button><button aria-pressed={window==='recent'} onClick={()=>{setWindow('recent');clearSelection(true);}}>{chinese?'近 30 天':'30d'}</button>{activityCompany&&<button className={liveStyles.companyFilter} aria-label={chinese?'清除公司事件筛选':'Clear company event filter'} onClick={()=>clearSelection()}>{activityCompany.symbol||companyName(activityCompany,locale)} ×</button>}</div>{!floatingCompany&&selectedDetails}<div className={liveStyles.rightBody} aria-busy={eventsPending}>{eventsPending?pendingEvents:<><div className={styles.eventSummary}><span>{loadedActivity.signals}{' '}{chinese?'份已加载来源文档':'loaded source documents'}</span><span><UiText text={"Updated ·"}/>{' '}{clock(until)}{' '}<UiText text={"ET"}/></span></div>{recentFallback&&<p className={styles.empty}><UiText text={"No new events in the available records today."}/><button onClick={()=>{setWindow('recent');clearSelection(true);}}><UiText text={"View recent events →"}/></button></p>}<IntelligenceActivityOverview events={overviewEvents} documents={activity.documents} complete={snapshot.statisticsComplete} companies={activityScope} recentFallback={false} period={window==='recent'?'recent':'today'} sourceFilter={sourceFilter} limit={snapshot.limit} truncated={snapshot.truncated} onSector={id=>{if(recentFallback)setWindow('recent');setSector(id);clearSelection();setCamera(value=>value+1);}} onSource={source=>{if(recentFallback)setWindow('recent');setSourceFilter(source);clearSelection(true);}} onEvent={id=>{setWindow('recent');activate(id);}}/><div id="intelligence-event-stream" className={styles.eventList}>{events.map(item=><div key={item.id} className={liveStyles.eventRow} data-calendar={Boolean(item.calendarEvents?.length)}><button aria-pressed={intelligenceEventMatchesId(item,eventId)} onClick={()=>{activate(item.id);}}><div><span><UiText text={item.category}/></span>{item.published_at?<RelativeTime value={item.published_at} interactive={false}/>:<time dateTime={item.published_at??item.publication_date}>{item.published_at?(item.publication_date===snapshot.session.date?'':shortDate(item.publication_date)+' ')+clock(Date.parse(item.published_at)):shortDate(item.publication_date)+' · '+ui('date only')}</time>}</div><strong title={intelligenceEventTitle(item,locale)!==item.title?item.title:undefined}>{intelligenceEventTitle(item,locale)}</strong><IntelligenceEventCompanies companyIds={region?item.companyIds.filter(id=>companiesById.has(id)):item.companyIds} companies={companiesById} chinese={chinese}/><IntelligenceEventPriceReturns returns={snapshot.eventReturns?.[item.id]?.filter(value=>companiesById.has(value.companyId)&&(!activityCompany||value.companyId===activityCompany.id))} symbol={label}/><small><span><UiText text={item.planned?'announced plan':''}/>{item.evidence.length>1&&(chinese?item.evidence.length+' 份来源文档':item.evidence.length+' source documents')}</span><span>↗</span></small></button><IntelligenceCalendarLinks events={activityCompany?item.calendarEvents?.filter(event=>event.companyId===activityCompany.id):region?item.calendarEvents?.filter(event=>companiesById.has(event.companyId)):item.calendarEvents}/></div>)}{!events.length&&!recentFallback&&<p className={styles.empty}>{activity.signals>0?(chinese?`匹配的来源未包含在最新 ${snapshot.limit} 条列表中，但已计入统计。`:`Matching sources are outside the latest ${snapshot.limit} entries shown, but are included in the totals.`):<UiText text={window==='today'?'No new events in the available records today.':'No recorded events match these filters.'}/>} {window==='today'&&activity.signals===0&&<button onClick={()=>{setWindow('recent');clearSelection(true);}}><UiText text={"View recent events →"}/></button>}</p>}</div>

      </>}</div><details className={styles.rightFoot} hidden={eventsPending}><summary>{chinese?'来源状态':'Source status'}{partialCoverage?' · ◐':''}</summary><p><UiText text={"Counts deduplicate source documents."}/></p>{snapshot.truncated&&<p>{chinese?`列表显示最新 ${snapshot.limit} 条；统计独立于列表上限。`:`The list shows the latest ${snapshot.limit} entries; totals are independent of the list limit.`}</p>}{newsCoverage&&<p>{chinese?'公司新闻覆盖':'Company news coverage'} {newsCoverage.configured}/{newsCoverage.total} · {newsCoverage.healthy} {chinese?'正常':'healthy'}</p>}{warnings.map(warning=><p key={warning}><UiText text={warning}/></p>)}</details>
    </aside>
    {followConfirmation&&<CompanyFollowConfirmation key={followConfirmation.id} label={followConfirmation.label} followed={followConfirmation.followed} anchor={followConfirmation.anchor}/>}
  </main>;
}
