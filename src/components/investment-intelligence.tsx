"use client";
import { IntelligenceSectorLegend } from './intelligence-sector-legend';
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';
import { LocalizedLink as Link } from './localized-link';
import Image from 'next/image';
import { demoEvents, demoGraph, demoSourceNames, type DemoSource } from '@/lib/knowledge-graph/intelligence-demo';
import { companySector, GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import { useAuth } from './providers/auth-provider';
import styles from './investment-intelligence.module.css';
import compactStyles from './intelligence-workspace-controls.module.css';
import summaryStyles from './intelligence-summary.module.css';
const Universe=lazy(()=>import('./company-graph-3d'));
const symbol=(id:string)=>id.replace('US:','');
const clock=(minute:number)=>`${String(9+Math.floor((30+minute)/60)).padStart(2,'0')}:${String((30+minute)%60).padStart(2,'0')}`;
const end=150;
const subscribeWidth=(notify:()=>void)=>{const media=matchMedia('(min-width: 1440px)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
const desktopWidth=()=>matchMedia('(min-width: 1440px)').matches;

export function InvestmentIntelligence(){
  const {user}=useAuth();
  const [leftChoice,setLeftOpen]=useState<boolean|null>(null),[rightOpen,setRightOpen]=useState(true);
  const wide=useSyncExternalStore(subscribeWidth,desktopWidth,()=>true);
  const leftOpen=leftChoice??wide;
  const [sector,setSector]=useState(''),[query,setQuery]=useState(''),[tab,setTab]=useState('all');
  const [watchlist,setWatchlist]=useState(['US:NVDA','US:AMD','US:MU','US:TSM']);
  const [sourceFilter,setSourceFilter]=useState<DemoSource | ''>(''),[activeOnly,setActiveOnly]=useState(false);
  const [selected,setSelected]=useState(''),[eventId,setEventId]=useState(''),[edgeId,setEdgeId]=useState('');
  const [camera,setCamera]=useState(0),[reset,setReset]=useState(0),[pulse,setPulse]=useState(0);
  const [minute,setMinute]=useState(end),[mode,setMode]=useState<'live'|'replay'>('live'),[playing,setPlaying]=useState(false),[propagating,setPropagating]=useState(false);
  const event=demoEvents.find(e=>e.id===eventId);
  const company=demoGraph.nodes.find(n=>n.id===selected);
  const scopeCompanies=demoGraph.nodes.filter(n=>(!sector||companySector(n).id===sector)&&(!query||`${n.symbol} ${n.name}`.toLowerCase().includes(query.toLowerCase()))&&(tab!=='watchlist'||watchlist.includes(n.id)));
  const scopeIds=new Set(scopeCompanies.map(n=>n.id));
  const eventMatchesScope=(e:typeof demoEvents[number])=>(!sourceFilter||e.sourceCounts[sourceFilter]>0)&&[e.origin,...e.targets.map(id=>`US:${id}`)].some(id=>scopeIds.has(id));
  const scopedEvents=[...demoEvents].reverse().filter(e=>(mode==='live'||e.minute<=minute)&&[e.origin,...e.targets.map(id=>`US:${id}`)].some(id=>scopeIds.has(id)));
  const visibleEvents=scopedEvents.filter(e=>!sourceFilter||e.sourceCounts[sourceFilter]>0);
  const activeIds=new Set(visibleEvents.flatMap(e=>[e.origin,...e.targets.map(id=>`US:${id}`)]).filter(id=>scopeIds.has(id)));
  const companies=scopeCompanies.filter(n=>(!activeOnly&&!sourceFilter)||activeIds.has(n.id));
  const sourceActivity=demoSourceNames.map(name=>({name,count:scopedEvents.reduce((total,e)=>total+e.sourceCounts[name],0)}));
  const signalCount=visibleEvents.reduce((total,e)=>total+(sourceFilter?e.sourceCounts[sourceFilter]:e.signals),0);
  const filteredCompanyIds=useMemo(()=>{
    const scope=demoGraph.nodes.filter(n=>(!sector||companySector(n).id===sector)&&(!query||`${n.symbol} ${n.name}`.toLowerCase().includes(query.toLowerCase()))&&(tab!=='watchlist'||watchlist.includes(n.id)));
    if(!activeOnly&&!sourceFilter&&!query&&tab!=='watchlist')return undefined;
    const ids=new Set(demoEvents.filter(e=>(mode==='live'||e.minute<=minute)&&(!sourceFilter||e.sourceCounts[sourceFilter]>0)).flatMap(e=>[e.origin,...e.targets.map(id=>`US:${id}`)]));
    return scope.filter(n=>(!activeOnly&&!sourceFilter)||ids.has(n.id)).map(n=>n.id);
  },[sector,query,tab,watchlist,activeOnly,sourceFilter,mode,minute]);
  const connections=event?demoGraph.relationships.filter(e=>e.id.startsWith(event.id+':')):selected?demoGraph.relationships.filter(e=>e.source===selected||e.target===selected):[];
  const intelligence=useMemo(()=>({origin:propagating?demoEvents.find(e=>e.id===eventId)?.origin??'':'',edges:propagating?demoGraph.relationships.filter(e=>e.id.startsWith(eventId+':')).map(e=>e.id):[]}),[eventId,propagating]);
  function showEvents(){setRightOpen(true);setSelected('');setEventId('');setEdgeId('');setPropagating(false);}
  function filterSource(source:DemoSource){setSourceFilter(current=>current===source?'':source);showEvents();}
  function focusCompany(id:string){setSelected(id);setCamera(v=>v+1);setEdgeId('');}
  function activate(id:string){const next=demoEvents.find(e=>e.id===id);if(!next)return;setEventId(id);focusCompany(next.origin);setPropagating(true);setPulse(v=>v+1);}
  function replayAt(value:number){setMode('replay');setMinute(value);const next=[...demoEvents].reverse().find(e=>e.minute<=value&&eventMatchesScope(e));if(next){activate(next.id);}else{setEventId('');setSelected('');setEdgeId('');setPropagating(false);}}
  function goLive(){setMode('live');setMinute(end);setPlaying(false);setEventId('');setEdgeId('');setSelected('');setPropagating(false);setReset(v=>v+1);}
  function toggleSaved(id:string){setWatchlist(list=>list.includes(id)?list.filter(x=>x!==id):[...list,id]);}
  useEffect(()=>{if(!propagating)return;const timer=setTimeout(()=>setPropagating(false),20000);return()=>clearTimeout(timer);},[propagating,pulse]);
  const replayTick=useEffectEvent(()=>{const value=Math.min(end,minute+1);setMinute(value);const next=[...demoEvents].reverse().find(e=>e.minute<=value&&eventMatchesScope(e));if(next&&next.id!==eventId)activate(next.id);if(value===end)setPlaying(false);});
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>replayTick(),100);return()=>clearInterval(timer);},[playing]);
  return <main className={`${styles.shell} ${leftOpen?'':styles.leftClosed} ${rightOpen?'':styles.rightClosed}`} data-intelligence-preview>
    <header className={styles.topbar}>
      <div className={styles.identity}><Link href="/" aria-label="YouAnalyst home"><Image src="/youanalyst-logo-mobile.svg" width={134} height={30} alt="YouAnalyst" priority/></Link><h1 className={styles.srOnly}>Investment Intelligence</h1><span className={styles.demoBadge}>MOCK DATA</span></div>
      <nav aria-label="Workspace navigation" className={styles.navigation}><Link href="/?view=graph">Map ↗</Link><Link href="/feed">Feed</Link><Link href="/watchlists">Watchlists</Link></nav>
      <div className={styles.session}><div className={compactStyles.liveControls}>{mode==='live'?<><span className={compactStyles.liveStatus}><i/>Live <small>demo</small></span><button aria-expanded={false} aria-controls="intraday-replay" onClick={()=>{setMode('replay');setPlaying(false);}}>Replay</button></>:<span className={compactStyles.liveStatus}>Replay <small>today</small></span>}</div><details className={compactStyles.more} onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>More ▾</summary><nav aria-label="More navigation" onClick={e=>{if((e.target as HTMLElement).closest('a'))e.currentTarget.closest('details')?.removeAttribute('open');}}>{[['/research','Research'],['/companies','Companies'],['/watchlists/following','Following'],['/predictions','Investment ideas'],['/my/predictions','My ideas'],['/compare','Performance comparison'],['/predictions/new','Publish an idea'],['/daily/calls','Top Calls'],['/how-it-works','How it works']].map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav></details><Link href={user?`/analysts/${user.uid}`:'/auth'} className={styles.account}>{user?'Account':'Sign in'}</Link></div>
    </header>
    <aside className={styles.left} aria-label="Universe navigation" data-filtered={Boolean(query)||tab==='watchlist'||activeOnly||Boolean(sourceFilter)}>
      <div className={styles.panelTitle}><strong>Explore universe</strong><button aria-label="Collapse left panel" onClick={()=>setLeftOpen(false)}>‹</button></div>
      <label className={styles.search}><span className={styles.srOnly}>Search companies</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search company / ticker"/></label>
      <div className={styles.sectionLabel}>INVESTMENT THEME</div><div className={styles.theme}><span>✦</span> AI <small>{demoGraph.nodes.length}</small></div>
      <div className={styles.sectionLabel}>SECTORS <button onClick={()=>setSector('')} aria-label="Clear sector focus">All</button></div>
      <div className={styles.sectors}>{GRAPH_SECTORS.map(s=><button key={s.id} aria-pressed={sector===s.id} onClick={()=>{setSector(sector===s.id?'':s.id);setSelected('');setEventId('');setPropagating(false);setCamera(v=>v+1);}}><span style={{background:s.color}}/>{s.en}<small>{demoGraph.nodes.filter(n=>companySector(n).id===s.id).length}</small></button>)}</div>
      <nav className={compactStyles.researchShortcuts} aria-label="Research shortcuts"><div className={compactStyles.researchHeading}>RESEARCH <Link href="/research">All ↗</Link></div><Link href="/research/nvidia-ai-ecosystem">NVIDIA suppliers & ecosystem ↗</Link><Link href="/research/amd-ai-ecosystem">AMD deployments & ecosystem ↗</Link><button onClick={()=>{setSector('infrastructure');setSelected('');setEventId('');setPropagating(false);setCamera(v=>v+1);}}>AI infrastructure bottlenecks →</button></nav>
      <div className={styles.listTabs}><button aria-pressed={tab==='all'} onClick={()=>setTab('all')}>Companies</button><button aria-pressed={tab==='watchlist'} onClick={()=>setTab('watchlist')}>Watchlist <small>{watchlist.length}</small></button></div>
      <div className={styles.companyList}>{companies.map(n=><div key={n.id} className={selected===n.id?styles.selectedCompany:undefined}><button onClick={()=>focusCompany(n.id)}><strong>{n.symbol}</strong><span>{n.name}</span></button><button aria-label={`${watchlist.includes(n.id)?'Unsave':'Save'} ${n.symbol}`} aria-pressed={watchlist.includes(n.id)} onClick={()=>toggleSaved(n.id)}>{watchlist.includes(n.id)?'★':'☆'}</button></div>)}{companies.length===0&&<p className={styles.empty}>No matching companies.</p>}</div>
      <div className={styles.leftFoot}>Local review · simulated universe</div>
    </aside>
    <section className={styles.center} aria-label="Graph universe">
      <div className={styles.graphToolbar}><div>{!leftOpen&&<button aria-label="Expand left panel" onClick={()=>setLeftOpen(true)}>☰ Explore</button>}<strong>Graph Universe</strong><span>{sector?GRAPH_SECTORS.find(s=>s.id===sector)?.en:'AI'}</span></div><div><span className={styles.monitor}><i/>{mode==='live'?'Demo monitoring':`Replay · ${clock(minute)}`}</span><button onClick={()=>{setSelected('');setSector('');setEdgeId('');setEventId('');setPropagating(false);setReset(v=>v+1);}} aria-label="Reset universe view">Reset ⤢</button>{!rightOpen&&<button onClick={()=>setRightOpen(true)}>Events ›</button>}</div></div>
      <div className={styles.graph}><Suspense fallback={<p className={styles.loading} role="status">Loading universe…</p>}><Universe graph={demoGraph} selected={selected} onSelect={focusCompany} sectorFocus={sector} cameraRequest={camera} reset={reset} onReset={()=>setReset(v=>v+1)} intelligence={intelligence} companyFocus={filteredCompanyIds} highlightedEdges={intelligence.edges} activeEdge={edgeId} onSelectEdge={setEdgeId} hideReset/></Suspense>
        <IntelligenceSectorLegend/>
        {event&&<div className={styles.eventOverlay}><span className={styles.sectionLabel}>{propagating?'EVENT PROPAGATION':'SELECTED EVENT'} · {event.time}</span><strong>{event.title}</strong><span>{event.targets.length} research paths · illustrative relationships</span></div>}
      </div>
      {mode==='replay'&&<section id="intraday-replay" className={styles.timeline} aria-label="Today's intraday replay">
        <div className={styles.timelineHeading}><strong>Today’s intraday replay</strong><span>Mock session</span><output>{clock(minute)}</output><button onClick={goLive}>Back to live</button></div>
        <div className={styles.timeControl}><button aria-label={playing?'Pause replay':'Play replay'} onClick={()=>{setMode('replay');if(!playing&&minute===end){setMinute(0);setEventId('');setSelected('');setPropagating(false);}setPlaying(v=>!v);}}>{playing?'Ⅱ':'▶'}</button><div className={styles.timeTrack}><label className={styles.srOnly} htmlFor="intelligence-time">Replay time</label><input id="intelligence-time" type="range" min={0} max={end} value={minute} onChange={e=>{setPlaying(false);replayAt(Number(e.target.value));}}/><div className={styles.eventTicks}>{demoEvents.map(e=><button key={e.id} aria-label={`Replay ${e.title} at ${e.time}`} style={{left:`${e.minute/end*100}%`}} onClick={()=>{setPlaying(false);replayAt(e.minute);}}><i/><span>{symbol(e.origin)}</span></button>)}</div><div className={styles.timeLabels}><span>09:30</span><span>10:00</span><span>10:30</span><span>11:00</span><span>11:30</span><span>12:00</span></div></div></div>
        <div className={styles.timelineFoot}><span><i/> Origin pulse</span><span>— Research connection</span><span>Animation indicates relevance, not price direction</span></div>
      </section>}
      <section className={summaryStyles.summary} aria-label="Theme activity summary">
        <span className={summaryStyles.context}>AI · {mode==='live'?'Today':`Through ${clock(minute)}`}</span>
        <button aria-label="Filter to active companies" aria-pressed={activeOnly} onClick={()=>{setActiveOnly(value=>!value);showEvents();}} title="Focus companies with activity in this scope"><span>Active companies</span><strong>{activeIds.size} / {scopeCompanies.length}</strong></button>
        <button aria-controls="intelligence-event-stream" onClick={showEvents}><span>Clusters</span><strong>{visibleEvents.length}</strong></button>
        <button aria-controls="intelligence-event-stream" onClick={showEvents}><span>{sourceFilter?`${sourceFilter} signals`:'Signals'}</span><strong>{signalCount}</strong></button>
        <div className={summaryStyles.sources}><span>Sources</span>{sourceActivity.map(source=><button key={source.name} aria-label={`Filter ${source.name} signals`} aria-pressed={sourceFilter===source.name} onClick={()=>filterSource(source.name)}><span>{source.name}</span><strong>{source.count}</strong></button>)}</div>
        {(activeOnly||sourceFilter)&&<button className={summaryStyles.clear} onClick={()=>{setActiveOnly(false);setSourceFilter('');showEvents();}}>Clear activity filters</button>}
      </section>
    </section>
    <aside className={styles.right} aria-label="Events and evidence">
      <div className={styles.panelTitle}><strong>What’s moving the universe</strong><button aria-label="Collapse right panel" onClick={()=>setRightOpen(false)}>›</button></div>
      <div className={styles.eventSummary}><span>{visibleEvents.length} clusters</span><span>Mock session · 09:30–12:00</span></div>
      <div id="intelligence-event-stream" className={styles.eventList}>{visibleEvents.map(e=><button key={e.id} aria-pressed={eventId===e.id} onClick={()=>{setPlaying(false);if(mode==='replay')setMinute(e.minute);activate(e.id);}}><div><span>{e.category}</span><time>{e.time}</time></div><strong>{e.title}</strong><p>{symbol(e.origin)} / {e.targets.join(' / ')}</p><small>{sourceFilter?e.sourceCounts[sourceFilter]:e.signals} {sourceFilter?`${sourceFilter} signals`:'signals'} · {e.sources} sources<span>↗</span></small></button>)}{visibleEvents.length===0&&<p className={styles.empty}>No event clusters match this scope and time.</p>}</div>
      {(event||company)&&<section className={styles.evidence} aria-live="polite"><div className={styles.panelTitle}><strong>{event?'Selected intelligence':company?.name}</strong><button aria-label="Close selected evidence" onClick={()=>{setSelected('');setEventId('');setEdgeId('');setPropagating(false);}}>×</button></div>{event?<><p>{event.summary}</p><div className={styles.evidenceNotice}>Simulated event · evidence placeholder</div></>:<p>{company?.name} · {company?companySector(company).en:''}<button className={styles.saveButton} onClick={()=>toggleSaved(selected)}>{watchlist.includes(selected)?'★ Saved':'☆ Save company'}</button></p>}<h2>Why these connections?</h2><div className={styles.researchPaths}>{connections.map(e=><button key={e.id} aria-pressed={edgeId===e.id} onClick={()=>{setEdgeId(e.id);focusCompany(e.source);setEdgeId(e.id);}}><span>{symbol(e.source)} <i>→</i> {symbol(e.target)}</span><small>{e.summary.replace('Simulated research relevance: ','').replace(/\.$/,'')}</small></button>)}{connections.length===0&&<p>No simulated connections for this company.</p>}</div><p className={styles.evidenceNote}>Connections illustrate research relevance. Real events will include primary sources and relationship verification.</p></section>}
      <section className={styles.activity}><div className={styles.sectionLabel}>INFORMATION ACTIVITY <span>DEMO</span></div>{sourceActivity.map(s=><div key={s.name}><span>{s.name}</span><i><b style={{width:`${s.count/Math.max(1,...sourceActivity.map(source=>source.count))*100}%`}}/></i><small>{s.count}</small></div>)}</section>
      <div className={styles.rightFoot}>All signals, counts and relationships shown here are simulated.</div>
    </aside>
  </main>;
}
