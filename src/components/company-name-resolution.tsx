"use client";
import { useEffect,useState } from 'react';
import { useAuth } from './providers/auth-provider';
import { useLocale } from './providers/locale-provider';
import { companyPageUrl } from '@/lib/market-companies/routes';
import { localizedPath } from '@/lib/i18n/urls';
import type { Locale } from '@/lib/locale';
import type { NameResolutionReceipt,IdentityCandidate,IdentityProposal } from '@/lib/market-companies/name-resolution';
import styles from './company-name-resolution.module.css';
const relationshipLabels={SUPPLIER_OF:['Supplier relationship','供应关系'],CUSTOMER_OF:['Customer relationship','客户关系'],PARTNER_OF:['Partnership','合作关系'],INTEGRATES_TECHNOLOGY_FROM:['Technology integration','技术集成'],PLANNED_ADOPTER_OF:['Planned adoption','计划采用'],ECOSYSTEM_PARTNER_OF:['Ecosystem partnership','生态合作'],ACQUIRES:['Acquisition','收购关系']};
const researchUrl=(id:string,locale:Locale)=>localizedPath(companyPageUrl(id.startsWith('US:')?id.slice(3):id),locale);

async function api(token:string,query='',body?:unknown){
 const response=await fetch('/api/company-name-resolution'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
function IdentityEndpoint({receipt,index,side,admin,onChanged}:{receipt:NameResolutionReceipt;index:number;side:'source'|'target';admin:boolean;onChanged:()=>void}){
 const {text,locale}=useLocale(),{getIdToken}=useAuth();
 const name=receipt.relationships[index][`${side}Name`];
 const [query,setQuery]=useState(name),[items,setItems]=useState<IdentityCandidate[]>([]),[selected,setSelected]=useState<IdentityCandidate|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[alias,setAlias]=useState(false),[evidence,setEvidence]=useState('');
 const proposals=receipt.proposals.filter(p=>p.relationshipIndex===index&&p.side===side&&p.status==='PENDING');
 async function search(){setBusy(true);setError('');setSelected(null);try{const token=await getIdToken();if(!token)throw new Error(text('Sign in first','请先登录'));setItems((await api(token,'?q='+encodeURIComponent(query))).items);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function act(action:'propose'|'approve'|'reject',proposal?:IdentityProposal){
  const companyId=proposal?.companyId??selected?.id;if(!companyId)return;
  setBusy(true);setError('');setMessage('');
  try{const token=await getIdToken();if(!token)throw new Error(text('Sign in first','请先登录'));
   await api(token,'',{action,receiptId:receipt.id,contentHash:receipt.contentHash,relationshipIndex:index,side,expectedName:name,companyId,...(proposal?{proposalId:proposal.id}:{}),...(action==='approve'&&alias?{reusableAlias:true,evidenceUrl:evidence}:{})});
   setMessage(action==='propose'?text('Match submitted for administrator review.','匹配已提交，等待管理员审核。'):text('Review saved.','审核已保存。'));setSelected(null);onChanged();
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className={styles.endpoint} aria-label={text('Resolve company name','匹配公司名称')+' '+name}>
  <strong>{name}</strong>
  <p>{text('Choose the same legal entity. A parent company and its subsidiary are separate identities.','请选择同一法律实体。母公司与子公司应保持独立身份。')}</p>
  <div className={styles.search}><label>{text('Company name or ticker','公司名称或代码')}<input value={query} maxLength={120} onChange={e=>{setQuery(e.target.value);setSelected(null);setItems([]);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search();}}}/></label><button type="button" disabled={busy||!query.trim()} onClick={()=>void search()}>{text('Search directory','搜索公司库')}</button></div>
  <a href={'https://www.google.com/search?q='+encodeURIComponent('"'+name+'" official company website')} target="_blank" rel="noopener noreferrer">{text('Find official identity evidence ↗','查找官方身份依据 ↗')}</a>
  {items.map(item=><button className={styles.candidate} key={item.id} type="button" aria-pressed={selected?.id===item.id} onClick={()=>setSelected(item)}>
   <strong>{item.legalName||item.name}</strong><span>{item.id} · {item.exchange||text('Exchange unverified','交易所待核实')} · {item.country||text('Country unverified','国家待核实')}</span><span>{item.website||text('Official website unavailable','暂无官方网站')}</span>
  </button>)}
  {!busy&&items.length===0&&query!==name&&<p>{text('Refine the name or ticker if no match appears.','如果没有匹配结果，请调整名称或代码。')}</p>}
  {admin&&<><label className={styles.check}><input type="checkbox" checked={alias} onChange={e=>setAlias(e.target.checked)}/>{text('Approve this name as a reusable alias for the same entity','将此名称批准为同一实体的可复用别名')}</label>{alias&&<label>{text('Official evidence URL','官方依据网址')}<input type="url" value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="https://…"/></label>}</>}
  {selected&&<button type="button" disabled={busy||alias&&!evidence.trim()} onClick={()=>void act(admin?'approve':'propose')}>{admin?text('Confirm article match','确认本文匹配'):text('Submit match for review','提交匹配供审核')}</button>}
  {proposals.map(p=><div key={p.id} className={styles.proposal}><p>{text('Proposed match','建议匹配')} · <a href={researchUrl(p.companyId,locale)} target="_blank" rel="noopener noreferrer">{p.companyId} ↗</a></p>{admin?<div className={styles.actions}><button type="button" disabled={busy||alias&&!evidence.trim()} onClick={()=>void act('approve',p)}>{text('Approve article match','批准本文匹配')}</button><button type="button" disabled={busy} onClick={()=>void act('reject',p)}>{text('Reject','拒绝')}</button></div>:<p>{text('Awaiting administrator review.','等待管理员审核。')}</p>}</div>)}
  {busy&&<p role="status">{text('Loading…','处理中…')}</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
export function ReceiptIdentityReview({receipt,admin,onChanged}:{receipt:NameResolutionReceipt;admin:boolean;onChanged:()=>void}){
 const {text,locale}=useLocale();
 return <div className={styles.review}><p>{text('Uncertain company identities are retained for review. Only administrator-approved aliases are reused in future articles.','不确定的公司身份会保留待审核。只有管理员批准的别名才会用于后续文章。')}</p>
  {receipt.relationships.map((r,index)=><section key={index}><p>{r.sourceName} → {r.targetName} · {text(...relationshipLabels[r.type] as [string,string])}</p><blockquote>{r.evidence}</blockquote>{r.sourceId&&r.targetId&&<p role="status">{text('Article identities matched','本文身份已匹配')} · <a href={researchUrl(r.sourceId,locale)} target="_blank" rel="noopener noreferrer">{r.sourceId}</a> → <a href={researchUrl(r.targetId,locale)} target="_blank" rel="noopener noreferrer">{r.targetId}</a></p>}{(['source','target'] as const).filter(side=>!r[`${side}Id`]||receipt.proposals.some(p=>p.relationshipIndex===index&&p.side===side&&p.status==='PENDING')).map(side=><IdentityEndpoint key={side} receipt={receipt} index={index} side={side} admin={admin} onChanged={onChanged}/>)}</section>)}
 </div>;
}
export function EventCompanyNameResolution({eventId}:{eventId:string}){
 const {user,getIdToken}=useAuth(),{text}=useLocale();
 const [open,setOpen]=useState(false),[data,setData]=useState<{receipt:NameResolutionReceipt|null;admin:boolean;owner:string}|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!open||!user)return;let canceled=false;
  void (async()=>{try{const token=await getIdToken();if(!token)return;const result=await api(token,'?event='+encodeURIComponent(eventId));if(!canceled){setData({...result,owner:user.uid});setError('');}}catch(e){if(!canceled)setError(e instanceof Error?e.message:String(e));}})();
  return()=>{canceled=true;};
 },[open,user,getIdToken,eventId,revision]);
 if(!user)return <a href="/auth">{text('Sign in to help resolve company names','登录后协助匹配公司名称')}</a>;
 const current=data?.owner===user.uid?data:null;
 return <div className={styles.review}><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>{text('Review company names','审核公司名称')}</button>{open&&(error?<p role="alert">{error}</p>:current?.receipt?<ReceiptIdentityReview receipt={current.receipt} admin={current.admin} onChanged={()=>setRevision(v=>v+1)}/>:<p>{current?text('No analyzed relationships are available for this article yet.','本文暂无可审核的关系分析。'):text('Loading…','加载中…')}</p>)}</div>;
}
export function AdminNameResolutions(){
 const {user,getIdToken}=useAuth(),{text}=useLocale();
 const [receipts,setReceipts]=useState<NameResolutionReceipt[]>([]),[after,setAfter]=useState(''),[next,setNext]=useState<string|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{if(!user)return;let canceled=false;void(async()=>{try{const token=await getIdToken();if(!token)return;const result=await api(token,'?after='+encodeURIComponent(after));if(!canceled){setReceipts(result.receipts);setNext(result.nextCursor);setLoaded(true);}}catch(e){if(!canceled)setError(e instanceof Error?e.message:String(e));}})();return()=>{canceled=true;};},[user,getIdToken,after,revision]);
 return <main className={styles.admin}><h1>{text('Company identity review','公司身份审核')}</h1><p>{text('Review article matches separately from reusable aliases. Confirm names against official evidence; preserve subsidiaries as distinct companies.','文章匹配与可复用别名应分别审核。请依据官方资料确认名称，并保持子公司的独立身份。')}</p>{error&&<p role="alert">{error}</p>}{!loaded&&<p role="status">{text('Loading…','加载中…')}</p>}
  {loaded&&receipts.length===0&&<p>{text('No unresolved names or pending proposals in this batch.','本批次没有待匹配名称或待审核建议。')}</p>}
  {receipts.map(receipt=><article key={receipt.id}><h2>{receipt.title}</h2><a href={receipt.sourceUrl} target="_blank" rel="noopener noreferrer">{text('Read original article ↗','阅读原文 ↗')}</a><ReceiptIdentityReview receipt={receipt} admin onChanged={()=>setRevision(v=>v+1)}/></article>)}
  <div className={styles.actions}><button type="button" onClick={()=>{setAfter('');setRevision(v=>v+1);}}>{text('Refresh from beginning','从头刷新')}</button>{next&&<button type="button" onClick={()=>{setAfter(next);setLoaded(false);}}>{text('Next batch','下一批')}</button>}</div>
 </main>;
}
