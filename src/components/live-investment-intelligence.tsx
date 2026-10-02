"use client";
import { UiText, useUiText } from "./ui-text";
import { IntelligenceSectorLegend } from './intelligence-sector-legend';
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { LocalizedLink as Link } from './localized-link';
import { useLocale } from './providers/locale-provider';
import { useCompanyFollows } from './company-follow-button';
import { companyName, companySearchText, matchesCompanySearch } from '@/lib/knowledge-graph/model';
import { companySector, GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import { researchCompanyUrl } from '@/lib/knowledge-graph/research-view';
import { relationshipVerification } from '@/lib/knowledge-graph/relationship-status';
import { summarizeIntelligence, type IntelligenceSnapshot, type IntelligenceSource } from '@/lib/intelligence/model';
import styles from './investment-intelligence.module.css';
import controls from './intelligence-workspace-controls.module.css';
import summaryStyles from './intelligence-summary.module.css';
import liveStyles from './intelligence-live.module.css';

const Universe=lazy(()=>import('./company-graph-3d'));
const subscribeWidth=(notify:()=>void)=>{const media=matchMedia('(min-width:1440px)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
const desktopWidth=()=>matchMedia('(min-width:1440px)').matches;
const clock=(value:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const shortDate=(value:string)=>value.slice(5);

/** Failure never falls back to demo data. Polls pause during replay and hidden tabs. */
export function LiveInvestmentIntelligence({initialSnapshot}:{initialSnapshot?:IntelligenceSnapshot}={}){
  const [snapshot,setSnapshot]=useState<IntelligenceSnapshot|null>(initialSnapshot??null);
  const [error,setError]=useState(''),[replaying,setReplaying]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let disposed=false,inFlight=false;
    let controller:AbortController|null=null;
    const refresh=async()=>{
      if(disposed||inFlight||replaying||document.visibilityState==='hidden')return;
      inFlight=true;controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),15_000);
      try{
        const response=await fetch('/api/intelligence',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error();
        const data:IntelligenceSnapshot=await response.json();
        if(!data.graphVersion||!Array.isArray(data.graph?.nodes)||!Array.isArray(data.events)||!data.session?.startAt)throw new Error();
        if(!disposed){setSnapshot(old=>old?.graphVersion===data.graphVersion?{...data,graph:old.graph}:data);setError('');}
      }catch{if(!disposed)setError('Unable to refresh investment intelligence.');}
      finally{clearTimeout(timeout);inFlight=false;}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),60_000);
    const onVisible=()=>void refresh();
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('focus',onVisible);
    return()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);};
  },[replaying,retry]);
  if(!snapshot)return <main className={liveStyles.loadingShell}><Link href="/" aria-label="YouAnalyst home"><Image src="/youanalyst-logo-mobile.svg" width={134} height={30} alt="YouAnalyst" priority/></Link><h1><UiText text={"Investment Intelligence"}/></h1><p role={error?'alert':'status'}><UiText text={error||'Loading companies and recorded evidence…'}/></p>{error&&<button onClick={()=>setRetry(value=>value+1)}><UiText text={"Retry connection"}/></button>}<nav aria-label="Research navigation"><Link href="/?view=graph"><UiText text={"Map"}/></Link><Link href="/research"><UiText text={"Research"}/></Link><Link href="/companies"><UiText text={"Companies"}/></Link><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA ecosystem"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD ecosystem"}/></Link></nav></main>;
  return <IntelligenceWorkspace snapshot={snapshot} error={error} reconnect={()=>setRetry(value=>value+1)} onReplayChange={setReplaying}/>;
}

function IntelligenceWorkspace({snapshot,error,reconnect,onReplayChange}:{snapshot:IntelligenceSnapshot;error:string;reconnect:()=>void;onReplayChange:(value:boolean)=>void}){
  const {locale,chinese}=useLocale();
  const ui=useUiText();
  const follows=useCompanyFollows();
  const [guestSaved,setGuestSaved]=useState<string[]>([]),[saveError,setSaveError]=useState('');
  const saved=follows.user?follows.ids:guestSaved;
  const wide=useSyncExternalStore(subscribeWidth,desktopWidth,()=>true);
  const [leftChoice,setLeftOpen]=useState<boolean|null>(null),[rightOpen,setRightOpen]=useState(true);
  const leftOpen=leftChoice??wide;
  const [sector,setSector]=useState(''),[query,setQuery]=useState(''),[tab,setTab]=useState('all');
  const [sourceFilter,setSourceFilter]=useState<IntelligenceSource|''>(''),[activeOnly,setActiveOnly]=useState(false);
  const [window,setWindow]=useState<'today'|'recent'>('today');
  const [selected,setSelected]=useState(''),[eventId,setEventId]=useState(''),[edgeId,setEdgeId]=useState('');
  const [camera,setCamera]=useState(0),[reset,setReset]=useState(0),[pulse,setPulse]=useState(0);
  const [mode,setMode]=useState<'live'|'replay'>('live'),[playing,setPlaying]=useState(false),[propagating,setPropagating]=useState(false);
  const start=Date.parse(snapshot.session.startAt),until=Date.parse(snapshot.generatedAt);
  const end=Math.max(1,Math.ceil((until-start)/60_000));
  const [minute,setMinute]=useState(end);
  const cutoff=mode==='replay'?Math.min(until,start+minute*60_000):undefined;
  const graph=snapshot.graph;
  const allCompanies=useMemo(()=>graph.nodes.filter(node=>node.kind==='COMPANY'),[graph]);
  const scope=useMemo(()=>allCompanies.filter(node=>(!sector||companySector(node).id===sector)&&(!query||matchesCompanySearch(companySearchText(graph,node),query))&&(tab!=='watchlist'||saved.includes(node.id))),[allCompanies,graph,sector,query,tab,saved]);
  const inWindow=snapshot.events.filter(event=>window==='recent'||event.observedDate===snapshot.session.date);
  const scopeIds=scope.map(node=>node.id);
  const activity=summarizeIntelligence(inWindow,scopeIds,sourceFilter,cutoff);
  const sourceActivity=summarizeIntelligence(inWindow,scopeIds,'',cutoff).sources;
  const events=activity.events;
  const activeIds=new Set(activity.activeIds);
  const companies=scope.filter(node=>(!activeOnly&&!sourceFilter)||activeIds.has(node.id));
  const company=allCompanies.find(node=>node.id===selected);
  const event=events.find(item=>item.id===eventId);
  const connections=graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(event?event.edgeIds.includes(edge.id):selected&&(edge.source===selected||edge.target===selected)));
  const intelligence={origin:propagating?event?.origin??'':'',edges:event?propagating?event.edgeIds:[]:selected?graph.relationships.filter(edge=>edge.type!=='PARTICIPATES_IN'&&relationshipVerification(edge)!=='TERMINATED'&&(edge.source===selected||edge.target===selected)).map(edge=>edge.id):[]};
  const filteredCompanyIds=activeOnly||sourceFilter?activity.activeIds:query||tab==='watchlist'?scopeIds:undefined;
  const replayEvents=snapshot.events.filter(item=>item.observedDate===snapshot.session.date&&item.observedAt);
  const latestBefore=(value:number)=>summarizeIntelligence(snapshot.events.filter(item=>item.observedDate===snapshot.session.date),scopeIds,sourceFilter,Math.min(until,start+value*60_000)).events[0];
  const label=(id:string)=>{const node=allCompanies.find(item=>item.id===id);return node?.symbol||node?.name||id;};

  function clearSelection(){setSelected('');setEventId('');setEdgeId('');setPropagating(false);}
  function showEvents(){setRightOpen(true);clearSelection();}
  function focusCompany(id:string){clearSelection();setSelected(id);setCamera(value=>value+1);}
  function activate(id:string){const next=snapshot.events.find(item=>item.id===id);if(!next)return;setEventId(id);setSelected(next.origin);setEdgeId('');setCamera(value=>value+1);setPropagating(true);setPulse(value=>value+1);}
  function goLive(){setMode('live');setPlaying(false);onReplayChange(false);clearSelection();setReset(value=>value+1);}
  function replayAt(value:number){setMinute(value);const next=latestBefore(value);if(next)activate(next.id);else clearSelection();}
  async function toggleSaved(id:string){
    setSaveError('');
    if(!follows.user){setGuestSaved(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);return;}
    try{await follows.change(id,!saved.includes(id));}catch{setSaveError('Could not save this company. Retry.');}
  }
  useEffect(()=>{if(!propagating)return;const timer=setTimeout(()=>setPropagating(false),20_000);return()=>clearTimeout(timer);},[propagating,pulse]);
  const replayTick=useEffectEvent(()=>{const value=Math.min(end,minute+1);setMinute(value);const next=latestBefore(value);if(next&&next.id!==eventId)activate(next.id);if(value===end)setPlaying(false);});
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>replayTick(),200);return()=>clearInterval(timer);},[playing]);

  return <main className={`${styles.shell} ${leftOpen?'':styles.leftClosed} ${rightOpen?'':styles.rightClosed}`}>
    <header className={styles.topbar}>
      <div className={styles.identity}><Link href="/" aria-label="YouAnalyst home"><Image src="/youanalyst-logo-mobile.svg" width={134} height={30} alt="YouAnalyst" priority/></Link><h1 className={styles.srOnly}><UiText text={"Investment Intelligence"}/></h1></div>
      <nav className={styles.navigation} aria-label="Workspace navigation"><Link href="/?view=graph"><UiText text={"Map ↗"}/></Link><Link href="/feed"><UiText text={"Feed"}/></Link><Link href="/watchlists"><UiText text={"Watchlists"}/></Link></nav>
      <div className={styles.session}><div className={controls.liveControls}><span className={controls.liveStatus}><UiText text={mode==='replay'?'Replay':error?'Disconnected':'Live'}/> <small>{mode==='replay'?snapshot.session.date:clock(until)+' ET'}</small></span>{mode==='live'&&<button disabled={!replayEvents.length} title={replayEvents.length?'Replay today’s recorded arrivals':'No timestamped arrivals recorded today'} aria-controls="intraday-replay" onClick={()=>{setWindow('today');setMode('replay');setMinute(end);setPlaying(false);clearSelection();onReplayChange(true);}}><UiText text={"Replay"}/></button>}</div><details className={controls.more} onKeyDown={key=>{if(key.key==='Escape'){key.currentTarget.open=false;key.currentTarget.querySelector('summary')?.focus();}}}><summary><UiText text={"More ▾"}/></summary><nav aria-label="More navigation">{[['/research','Research'],['/?view=tree','Industry tree'],['/?view=hierarchy','Company hierarchy'],['/companies','Companies'],['/watchlists/following','Following'],['/predictions','Investment ideas'],['/my/predictions','My ideas'],['/compare','Performance comparison'],['/predictions/new','Publish an idea'],['/daily/calls','Top Calls'],['/how-it-works','How it works']].map(([href,title])=><Link key={href} href={href}><UiText text={title}/></Link>)}</nav></details><Link className={styles.account} href={follows.user?`/analysts/${follows.user.uid}`:'/auth'}><UiText text={follows.user?'Account':'Sign in'}/></Link></div>
    </header>
    <aside className={styles.left} aria-label="Universe navigation" data-filtered={Boolean(query)||tab==='watchlist'||activeOnly||Boolean(sourceFilter)}>
      <div className={styles.panelTitle}><strong><UiText text={"Explore universe"}/></strong><button aria-label="Collapse left panel" onClick={()=>setLeftOpen(false)}>‹</button></div>
      <label className={styles.search}><span className={styles.srOnly}><UiText text={"Search companies"}/></span><input value={query} onChange={change=>{setQuery(change.target.value);clearSelection();}} placeholder={ui('Search company / ticker')}/></label>
      <div className={styles.sectionLabel}><UiText text={"INVESTMENT THEME"}/></div><div className={styles.theme}><span>✦</span> AI <small>{allCompanies.length}</small></div>
      <div className={styles.sectionLabel}><UiText text={"SECTORS"}/>{' '}<button aria-label="Clear sector focus" onClick={()=>{setSector('');clearSelection();}}><UiText text={"All"}/></button></div>
      <div className={styles.sectors}>{GRAPH_SECTORS.map(item=><button key={item.id} aria-pressed={sector===item.id} onClick={()=>{setSector(sector===item.id?'':item.id);clearSelection();setCamera(value=>value+1);}}><span style={{background:item.color}}/>{chinese?item.zh:item.en}<small>{allCompanies.filter(node=>companySector(node).id===item.id).length}</small></button>)}</div>
      <nav className={controls.researchShortcuts} aria-label="Research shortcuts"><div className={controls.researchHeading}><UiText text={"RESEARCH"}/>{' '}<Link href="/research"><UiText text={"All ↗"}/></Link></div><Link href="/research/nvidia-ai-ecosystem"><UiText text={"NVIDIA suppliers & ecosystem ↗"}/></Link><Link href="/research/amd-ai-ecosystem"><UiText text={"AMD deployments & ecosystem ↗"}/></Link><button onClick={()=>{setSector('infrastructure');clearSelection();setCamera(value=>value+1);}}><UiText text={"AI infrastructure bottlenecks →"}/></button></nav>
      <div className={styles.listTabs}><button aria-pressed={tab==='all'} onClick={()=>{setTab('all');clearSelection();}}><UiText text={"Companies"}/></button><button aria-pressed={tab==='watchlist'} onClick={()=>{setTab('watchlist');clearSelection();}}><UiText text={"Watchlist"}/>{' '}<small>{saved.length}</small></button></div>
      <div className={styles.companyList}>{companies.map(node=><div key={node.id} className={selected===node.id?styles.selectedCompany:undefined}><button onClick={()=>focusCompany(node.id)}><strong>{node.symbol||node.name}</strong><span>{companyName(node,locale)}</span></button><button aria-label={`${saved.includes(node.id)?'Unsave':'Save'} ${node.symbol||node.name}`} aria-pressed={saved.includes(node.id)} disabled={Boolean(follows.user)&&!follows.ready} onClick={()=>void toggleSaved(node.id)}>{saved.includes(node.id)?'★':'☆'}</button></div>)}{!companies.length&&<p className={styles.empty}><UiText text={"No matching companies."}/></p>}</div>
      <div className={styles.leftFoot}><UiText text={saveError||(!follows.user&&saved.length?'Session watchlist · sign in to persist':'Evidence-backed company universe')}/></div>
    </aside>
    <section className={styles.center} aria-label="Graph universe">
      <div className={styles.graphToolbar}><div>{!leftOpen&&<button aria-label="Expand left panel" onClick={()=>setLeftOpen(true)}><UiText text={"☰ Explore"}/></button>}<strong><UiText text={"Graph Universe"}/></strong><span>{sector?GRAPH_SECTORS.find(item=>item.id===sector)?.[chinese?'zh':'en']:'AI'}</span></div><div><span className={styles.monitor}><UiText text={"Recorded evidence"}/></span><button aria-label="Reset universe view" onClick={()=>{clearSelection();setSector('');setSourceFilter('');setActiveOnly(false);setReset(value=>value+1);}}><UiText text={"Reset ⤢"}/></button>{!rightOpen&&<button onClick={()=>setRightOpen(true)}><UiText text={"Events ›"}/></button>}</div></div>
      {error&&<div className={liveStyles.notice} role="alert"><UiText text={"Connection interrupted. Showing the last received data."}/>{' '}<button onClick={reconnect}><UiText text={"Retry"}/></button></div>}
      <div className={styles.graph}><Suspense fallback={<p className={styles.loading} role="status"><UiText text={"Loading universe…"}/></p>}><Universe graph={graph} selected={selected} onSelect={focusCompany} sectorFocus={sector} cameraRequest={camera} reset={reset} onReset={()=>setReset(value=>value+1)} intelligence={intelligence} companyFocus={filteredCompanyIds} activeEdge={edgeId} onSelectEdge={setEdgeId} hideReset/></Suspense><IntelligenceSectorLegend/>{event&&<div className={styles.eventOverlay}><span className={styles.sectionLabel}>{event.category} · {event.observedAt?clock(Date.parse(event.observedAt))+' ET':event.observedDate}</span><strong>{event.title}</strong><span>{event.evidence.length}{' '}<UiText text={"source document ·"}/>{' '}{connections.length}{' '}<UiText text={"documented research paths"}/></span></div>}</div>
      {mode==='replay'&&<section id="intraday-replay" className={styles.timeline} aria-label="Today's intraday replay"><div className={styles.timelineHeading}><strong><UiText text={"Today’s recorded arrivals"}/></strong><span>{snapshot.session.date}{' '}<UiText text={"· ET"}/></span><output>{clock(Math.min(until,start+minute*60_000))}</output><button onClick={goLive}><UiText text={"Back to live"}/></button></div><div className={styles.timeControl}><button aria-label={playing?'Pause replay':'Play replay'} onClick={()=>{if(!playing&&minute===end)replayAt(0);setPlaying(value=>!value);}}>{playing?'Ⅱ':'▶'}</button><div className={styles.timeTrack}><label htmlFor="intelligence-time" className={styles.srOnly}><UiText text={"Replay time"}/></label><input id="intelligence-time" type="range" min={0} max={end} value={Math.min(minute,end)} onChange={change=>{setPlaying(false);replayAt(Number(change.target.value));}}/><div className={styles.eventTicks}>{replayEvents.map(item=><button key={item.id} aria-label={`Replay ${item.title}`} title={item.title} style={{left:`${Math.min(100,(Date.parse(item.observedAt!)-start)/(end*60_000)*100)}%`}} onClick={()=>{setPlaying(false);replayAt(Math.ceil((Date.parse(item.observedAt!)-start)/60_000));}}><i/></button>)}</div><div className={styles.timeLabels}><span>00:00</span><span>{clock(until)}</span></div></div></div><div className={styles.timelineFoot}><UiText text={"Source publication dates remain separate. Evidence without an exact arrival time is excluded from replay."}/></div></section>}
      <section className={summaryStyles.summary} aria-label="Theme activity summary"><span className={summaryStyles.context}>AI{' ·'}{' '}{ui(mode==='replay'?`Through ${clock(cutoff!)}`:window==='today'?'Today':'Last 30 days')}<UiText text={snapshot.truncated?' · limited coverage':snapshot.warnings.length?' · partial coverage':''}/></span><button aria-label="Filter to active companies" aria-pressed={activeOnly} onClick={()=>{setActiveOnly(value=>!value);showEvents();}}><span><UiText text={"Active companies"}/></span><strong>{activity.activeIds.length} / {scope.length}</strong></button><button onClick={showEvents} aria-controls="intelligence-event-stream"><span><UiText text={"Clusters"}/></span><strong>{events.length}</strong></button><button onClick={showEvents} aria-controls="intelligence-event-stream"><span><UiText text={"Source documents"}/></span><strong>{activity.signals}</strong></button><div className={summaryStyles.sources}><span><UiText text={"Sources"}/></span>{sourceActivity.map(source=>{const available=snapshot.coverage.find(item=>item.channel===source.name)?.status!=='unavailable';return <button key={source.name} aria-label={`Filter ${source.name} signals`} aria-pressed={sourceFilter===source.name} disabled={!available} title={available?'Recorded source documents':'Source not connected'} onClick={()=>{setSourceFilter(sourceFilter===source.name?'':source.name);showEvents();}}>{source.name}<strong>{available?source.count:'—'}</strong></button>;})}</div>{(activeOnly||sourceFilter)&&<button className={summaryStyles.clear} onClick={()=>{setActiveOnly(false);setSourceFilter('');showEvents();}}><UiText text={"Clear activity filters"}/></button>}</section>
    </section>
    <aside className={styles.right} aria-label="Events and evidence"><div className={styles.panelTitle}><strong><UiText text={"What’s moving the universe"}/></strong><button aria-label="Collapse right panel" onClick={()=>setRightOpen(false)}>›</button></div><div className={liveStyles.windowControls}><button aria-pressed={window==='today'} onClick={()=>{setWindow('today');clearSelection();}}><UiText text={"Today"}/></button><button aria-pressed={window==='recent'} disabled={mode==='replay'} onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"Recent evidence"}/></button></div><div className={styles.eventSummary}><span>{events.length}{' '}<UiText text={"clusters"}/></span><span><UiText text={"Recorded ·"}/>{' '}{clock(until)}{' '}<UiText text={"ET"}/></span></div><div id="intelligence-event-stream" className={styles.eventList}>{events.map(item=><button key={item.id} aria-pressed={eventId===item.id} onClick={()=>{setPlaying(false);activate(item.id);}}><div><span><UiText text={item.category}/></span><time dateTime={item.observedAt??item.observedDate}>{item.observedAt?(item.observedDate===snapshot.session.date?'':shortDate(item.observedDate)+' ')+clock(Date.parse(item.observedAt)):shortDate(item.observedDate)+' · '+ui('date only')}</time></div><strong>{item.title}</strong><p>{item.companyIds.map(label).join(' / ')}</p><small>{item.evidence.length}{' '}<UiText text={"source document"}/><UiText text={item.planned?' · announced plan':''}/><span>↗</span></small></button>)}{!events.length&&<p className={styles.empty}><UiText text={mode==='replay'?'No arrivals recorded before this time.':window==='today'?'No new evidence in the available records today.':'No recorded evidence matches these filters.'}/>{mode==='live'&&window==='today'&&<button onClick={()=>{setWindow('recent');clearSelection();}}><UiText text={"View recent evidence →"}/></button>}</p>}</div>
      {(event||company)&&<section className={styles.evidence}><div className={styles.panelTitle}><strong>{event?ui('Selected intelligence'):company?companyName(company,locale):''}</strong><button aria-label="Close selected evidence" onClick={clearSelection}>×</button></div>{event?<><p>{event.summary}</p><div className={liveStyles.dates}><UiText text={"Recorded"}/>{' '}{event.observedAt?new Date(event.observedAt).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':event.observedDate+' ('+ui('date only')+')'}{event.eventDate&&<><br/><UiText text={"Business / filing date"}/>{' '}{event.eventDate}</>}</div><nav aria-label="Primary evidence" className={liveStyles.evidenceLinks}>{event.evidence.map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.channel} · {source.title} ↗<small>{source.sourceDate?ui('Published')+' '+source.sourceDate:ui('Publication date unavailable')}</small></a>)}</nav></>:<p>{company?.summary||'Explore the company’s published relationship evidence.'}<button className={styles.saveButton} onClick={()=>void toggleSaved(selected)}><UiText text={saved.includes(selected)?'★ Saved':'☆ Save company'}/></button></p>}<h2><UiText text={"Research connections"}/></h2><div className={styles.researchPaths}>{connections.map(edge=><button key={edge.id} aria-pressed={edgeId===edge.id} onClick={()=>{setEdgeId(edge.id);setSelected(edge.source);setCamera(value=>value+1);}}><span>{label(edge.source)} <i>→</i> {label(edge.target)}</span><small>{edge.summary}</small></button>)}{!connections.length&&<p><UiText text={"No documented relationship paths for this signal."}/></p>}</div>{!event&&company&&<nav aria-label="Company research" className={liveStyles.evidenceLinks}><Link href={researchCompanyUrl(company)}><UiText text={"Company research ↗"}/></Link>{graph.sources.filter(source=>connections.some(edge=>edge.sourceIds.includes(source.id))).slice(0,8).map(source=><a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</nav>}<p className={styles.evidenceNote}><UiText text={"Source activity and research relevance do not indicate price direction or verify that an announced plan has been delivered."}/></p></section>}
      <div className={styles.rightFoot}><UiText text={"Counts deduplicate source documents."}/>{snapshot.coverage.some(item=>item.status==='unavailable')&&<>{' '}<UiText text={"Not connected:"}/>{' '}{snapshot.coverage.filter(item=>item.status==='unavailable').map(item=>item.channel).join(', ')}.</>}{snapshot.truncated&&<p><UiText text={"SEC coverage is limited to"}/>{' '}{snapshot.limit}{' '}<UiText text={"most recent records."}/></p>}{snapshot.warnings.map(warning=><p key={warning}><UiText text={warning}/></p>)}</div>
    </aside>
  </main>;
}
