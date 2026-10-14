import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { companyFields } from './model';
import { validateNewsAnalysis, articleHash, newsNameMentioned, type NewsRelationship } from '../intelligence/collectors/news-analysis';
import { canonicalEvidenceUrl } from '../intelligence/model';

export class NameResolutionError extends Error { constructor(public status:number,message:string){super(message);} }
export type IdentityProposal={id:string;relationshipIndex:number;side:'source'|'target';name:string;companyId:string;proposedBy:string;proposedAt:string;status:'PENDING'|'APPROVED'|'REJECTED';reviewedBy?:string;reviewedAt?:string;reusableAlias?:boolean;evidenceUrl?:string};
export type NameResolutionReceipt={id:string;sourceEventId:string;title:string;sourceUrl:string;contentHash:string;relationships:NewsRelationship[];proposals:IdentityProposal[];companySlugs?:Record<string,string>};
export type IdentityCandidate={id:string;name:string;legalName:string;country:string;website:string;symbol:string;exchange:string;aliases:string[]};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const idPattern=/^(US:[A-Z0-9.-]{1,30}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/;
const fail=(status:number,message:string):never=>{throw new NameResolutionError(status,message);};
function https(value:unknown){try{const url=new URL(String(value));return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=2000?url.href:'';}catch{return '';}}
function validReceipt(id:string,data:Record<string,unknown>){
 if(!/^news_analysis_[a-f0-9]{64}$/.test(id)||data.type!=='news_analysis'||data.status!=='complete'||typeof data.content!=='string'||typeof data.contentHash!=='string'||data.contentHash!==articleHash(data.content)||typeof data.sourceEventId!=='string')fail(404,'Analysis unavailable');
 const relationships=record(data.analysis).relationships;
 if(!Array.isArray(relationships)||relationships.length>15)fail(404,'Analysis unavailable');
 return relationships as NewsRelationship[];
}
function dto(id:string,data:Record<string,unknown>,uid:string,admin:boolean):NameResolutionReceipt{
 return {id,sourceEventId:String(data.sourceEventId),title:String(data.title??''),sourceUrl:https(data.sourceUrl),contentHash:String(data.contentHash),relationships:validReceipt(id,data),proposals:(Array.isArray(data.identityProposals)?data.identityProposals:[]).filter((p:IdentityProposal)=>admin||p.proposedBy===uid)};
}
async function attachCompanySlugs(db:Firestore,receipts:NameResolutionReceipt[]){
 const ids=[...new Set(receipts.flatMap(r=>[...r.relationships.flatMap(edge=>[edge.sourceId,edge.targetId]),...r.proposals.map(p=>p.companyId)]))].filter((id):id is string=>typeof id==='string'&&idPattern.test(id));
 const slugs:Record<string,string>={};
 for(let offset=0;offset<ids.length;offset+=100) await Promise.all(ids.slice(offset,offset+100).map(async id=>{
  const data=(await db.collection('companies').doc(id).get()).data();
  if(data&&['DIRECTORY','PUBLISHED'].includes(String(data.status))&&typeof data.slug==='string') slugs[id]=data.slug;
 }));
 return receipts.map(receipt=>({...receipt,companySlugs:slugs}));
}
export async function getNameResolution(db:Firestore,eventId:string,uid:string,admin:boolean){
 const id=eventId.replace(/^news-/,'');
 if(!/^company_news_[a-f0-9]{64}$/.test(id))fail(400,'Invalid news event');
 const source=(await db.collection('events').doc(id).get()).data()??{};
 if(source?.type!=='company_news'||source.sourceType!=='company_ir')fail(404,'News unavailable');
 const receiptId=record(source.newsAnalysis).receiptId;
 if(typeof receiptId!=='string')return {receipt:null};
 const data=(await db.collection('events').doc(receiptId).get()).data();
 if(!data||data.sourceEventId!==id||data.sourceUrl!==canonicalEvidenceUrl(String(source.url??''))||data.title!==source.title||data.status!=='complete')return {receipt:null};
 return {receipt:(await attachCompanySlugs(db,[dto(receiptId,data,uid,admin)]))[0]};
}
export async function listNameResolutions(db:Firestore,uid:string,after=''){
 if(after&&!/^news_analysis_[a-f0-9]{64}$/.test(after))fail(400,'Invalid cursor');
 const query=db.collection('events').orderBy(FieldPath.documentId()).endBefore('news_analysis_\uf8ff');
 const page=await (after?query.startAfter(after):query.startAt('news_analysis_')).limit(30).get();
 const receipts:NameResolutionReceipt[]=[];
 for(const doc of page.docs){const data=doc.data();if(data.status!=='complete')continue;const item=dto(doc.id,data,uid,true);if(item.relationships.some(r=>!r.sourceId||!r.targetId)||item.proposals.some(p=>p.status==='PENDING'))receipts.push(item);}
 return {receipts:await attachCompanySlugs(db,receipts),nextCursor:page.size===30?page.docs.at(-1)!.id:null};
}
export async function searchIdentityCandidates(db:Firestore,raw:string){
 const q=normalize(raw);if(!q||q.length>120)return {items:[]};
 const collection=db.collection('companies');
 const snapshots=await Promise.all([collection.where('searchPrefixes','array-contains',q.slice(0,32)).limit(50).get(),collection.where('symbolLower','==',q).limit(20).get(),collection.where('aliasKeys','array-contains',q).limit(20).get()]);
 let rows=[...new Map(snapshots.flatMap(page=>page.docs).map(doc=>[doc.id,doc])).values()];
 // Candidate discovery can broaden a multi-word query; it never assigns an ID.
 // For example, "Arista Networks" may be stored simply as "Arista".
 const token=q.split(' ').find(word=>word.length>=2&&!['the','inc','corporation','corp','company','limited','ltd','plc','holdings','group'].includes(word));
 if(!rows.some(doc=>['PUBLISHED','DIRECTORY'].includes(doc.data().status))&&token&&token!==q){rows=(await collection.where('searchPrefixes','array-contains',token.slice(0,32)).limit(50).get()).docs;}
 const items=rows.filter(doc=>['PUBLISHED','DIRECTORY'].includes(doc.data().status)&&typeof doc.data().name==='string'&&doc.data().name.trim()).map(doc=>{
  const d=doc.data(),aliases=Array.isArray(d.aliases)?d.aliases.filter((a:unknown):a is string=>typeof a==='string'):[];
  return {id:doc.id,name:String(d.name??''),legalName:String(d.legalName??d.name??''),country:String(d.country??''),website:https(d.website??record(d.profile).website),symbol:String(d.symbol??doc.id.split(':').at(-1)),exchange:String(d.exchange??(Array.isArray(d.listings)?d.listings[0]?.exchange:'' )??''),aliases};
 }).sort((a,b)=>Number(normalize(b.symbol)===q||normalize(b.name)===q||b.aliases.some(n=>normalize(n)===q))-Number(normalize(a.symbol)===q||normalize(a.name)===q||a.aliases.some(n=>normalize(n)===q))).slice(0,20);
 return {items};
}
type Action={action:'propose'|'approve'|'reject';receiptId:string;contentHash:string;relationshipIndex:number;side:'source'|'target';expectedName:string;companyId:string;proposalId?:string;reusableAlias?:boolean;evidenceUrl?:string};
export function parseIdentityAction(raw:unknown):Action{
 const d=record(raw);
 if(Object.keys(d).some(k=>!['action','receiptId','contentHash','relationshipIndex','side','expectedName','companyId','proposalId','reusableAlias','evidenceUrl'].includes(k))||!['propose','approve','reject'].includes(String(d.action))||typeof d.receiptId!=='string'||!/^news_analysis_[a-f0-9]{64}$/.test(d.receiptId)||typeof d.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(d.contentHash)||!Number.isInteger(d.relationshipIndex)||Number(d.relationshipIndex)<0||Number(d.relationshipIndex)>14||!['source','target'].includes(String(d.side))||typeof d.expectedName!=='string'||!d.expectedName.trim()||d.expectedName.length>120||/[\p{Cc}\p{Cf}<>]/u.test(d.expectedName)||typeof d.companyId!=='string'||!idPattern.test(d.companyId)||d.proposalId!==undefined&&(typeof d.proposalId!=='string'||!/^[a-f0-9]{64}$/.test(d.proposalId))||d.reusableAlias!==undefined&&typeof d.reusableAlias!=='boolean'||d.evidenceUrl!==undefined&&(typeof d.evidenceUrl!=='string'||!https(d.evidenceUrl)))fail(400,'Invalid identity review');
 if(d.action==='propose'&&(d.reusableAlias||d.proposalId||d.evidenceUrl))fail(400,'Article proposals cannot approve aliases');
 if(d.action==='reject'&&!d.proposalId)fail(400,'Select a proposal to reject');
 if(d.reusableAlias&&d.action!=='approve')fail(400,'Only approval can teach an alias');
 if(d.reusableAlias&&!d.evidenceUrl)fail(400,'Reusable aliases require source evidence');
 return d as Action;
}
export async function reviewCompanyIdentity(db:Firestore,raw:unknown,actor:{uid:string;admin:boolean},at=new Date().toISOString()){
 const input=parseIdentityAction(raw);
 if(input.action!=='propose'&&!actor.admin)fail(403,'Administrator review required');
 const receiptRef=db.collection('events').doc(input.receiptId),companyRef=db.collection('companies').doc(input.companyId);
 return db.runTransaction(async tx=>{
  const receipt=(await tx.get(receiptRef)).data()??{},relationships=validReceipt(input.receiptId,receipt).map(r=>({...r}));
  if(receipt.contentHash!==input.contentHash)fail(409,'Article changed; reload');
  const relationship=relationships[input.relationshipIndex];
  if(!relationship||relationship[`${input.side}Name`]!==input.expectedName)fail(409,'Company name changed; reload');
  if(!newsNameMentioned(input.expectedName,String(receipt.title)+'\n'+String(receipt.content)))fail(400,'Company name is absent from the original article and headline');
  const sourceRef=db.collection('events').doc(String(receipt.sourceEventId));
  const source=(await tx.get(sourceRef)).data()??{},company=(await tx.get(companyRef)).data()??{};
  if(source?.type!=='company_news'||source.sourceType!=='company_ir'||canonicalEvidenceUrl(String(source.url??''))!==receipt.sourceUrl||source.title!==receipt.title)fail(409,'Source changed; review the current article');
  if(!['PUBLISHED','DIRECTORY'].includes(company.status)||typeof company.name!=='string'||!company.name.trim())fail(404,'Company unavailable');
  const proposals:IdentityProposal[]=Array.isArray(receipt.identityProposals)?receipt.identityProposals.map(p=>({...p})):[];
  const ownId=createHash('sha256').update(`${actor.uid}|${input.relationshipIndex}|${input.side}`).digest('hex');
  let proposal=proposals.find(p=>p.id===(input.proposalId??ownId));
  if(input.action==='propose'){
   if(proposal&&proposal.status!=='PENDING')fail(409,'Proposal already reviewed');
   if(!proposal&&proposals.length>=50)fail(429,'Article proposal limit reached');
   const item:IdentityProposal={id:ownId,relationshipIndex:input.relationshipIndex,side:input.side,name:input.expectedName,companyId:input.companyId,proposedBy:actor.uid,proposedAt:at,status:'PENDING'};
   tx.update(receiptRef,{identityProposals:[...proposals.filter(p=>p.id!==ownId),item]});return {status:'PENDING'};
  }
  if(input.proposalId&&!proposal||proposal&&(proposal.relationshipIndex!==input.relationshipIndex||proposal.side!==input.side||proposal.name!==input.expectedName||proposal.companyId!==input.companyId))fail(409,'Proposal changed; reload');
  if(proposal&&proposal.status!=='PENDING')fail(409,'Proposal already reviewed');
  if(!proposal){if(proposals.length>=50)fail(429,'Article proposal limit reached');proposal={id:ownId,relationshipIndex:input.relationshipIndex,side:input.side,name:input.expectedName,companyId:input.companyId,proposedBy:actor.uid,proposedAt:at,status:'PENDING'};proposals.push(proposal);}
  const aliasKey=articleHash(normalize(input.expectedName));
  let candidateRef:ReturnType<Firestore['doc']>|null=null,candidate:Record<string,unknown>|null=null;
  if(input.action==='approve'){
   if(relationship[`${input.side}Id`]&&relationship[`${input.side}Id`]!==input.companyId)fail(409,'This name is already resolved to another company');
   relationship[`${input.side}Id`]=input.companyId;
   if(relationship.sourceId&&relationship.sourceId===relationship.targetId)fail(400,'A company cannot have a relationship with itself');
   // The original validator preserves quote, language, direction and status rules.
   validateNewsAnalysis({relationships},String(receipt.content),[...new Set(relationships.flatMap(r=>[r.sourceId,r.targetId]).filter(Boolean))].map(id=>({id,kind:'COMPANY' as const,order:0})));
   if(relationship.sourceId&&relationship.targetId&&relationship.confidence>=.7){
    const id='news:'+articleHash([String(receipt.sourceUrl),relationship.sourceId,relationship.targetId,relationship.type].join('|'));
    candidateRef=db.collection('company_relationships').doc(id);
    const existing=await tx.get(candidateRef);
    if(!existing.exists)candidate={id,recordKind:'NEWS_OBSERVATION',status:'NEEDS_REVIEW',source:relationship.sourceId,target:relationship.targetId,type:relationship.type,summary:relationship.summaryEn,summaryTranslations:{'zh-CN':{source:relationship.summaryEn,text:relationship.summaryZh,translatedAt:at}},commercialStatus:relationship.state,confidence:relationship.confidence,product:relationship.product,eventDate:relationship.eventDate,sourceEventId:receipt.sourceEventId,analysisReceiptId:input.receiptId,contentHash:receipt.contentHash,createdAt:at,evidence:[{id:input.receiptId,url:receipt.sourceUrl,title:receipt.title,sourceDate:source.publication_date??null,summary:relationship.evidence}]};
   }
   if(input.reusableAlias){
    const aliases=Array.isArray(company.aliases)?company.aliases.filter((n:unknown):n is string=>typeof n==='string'):[];
    if(!aliases.some(n=>normalize(n)===normalize(input.expectedName))){if(aliases.length>=100)fail(409,'Company alias limit reached');aliases.push(input.expectedName);}
    const priorReview=record(record(company.aliasReviews)[aliasKey]);
    const confirmation={evidenceUrl:https(input.evidenceUrl),receiptId:input.receiptId,approvedBy:actor.uid,approvedAt:at};
    // Later evidence stays on article receipts; keep bounded references here
    // rather than duplicating long URLs throughout the company master record.
    const references=(Array.isArray(priorReview.confirmations)?priorReview.confirmations:[]).map(p=>({receiptId:p.receiptId,approvedBy:p.approvedBy,approvedAt:p.approvedAt}));
    tx.update(companyRef,{aliases,aliasKeys:[...new Set(aliases.map(normalize))],searchPrefixes:companyFields(input.companyId,{...company,aliases}).searchPrefixes,[`aliasReviews.${aliasKey}`]:{alias:input.expectedName,...(Object.keys(priorReview).length?priorReview:confirmation),confirmations:[...references,{receiptId:confirmation.receiptId,approvedBy:confirmation.approvedBy,approvedAt:confirmation.approvedAt}].slice(-10)}});
    tx.set(db.collection('directory_syncs').doc('company_names'),{revision:randomUUID()},{merge:true});
   }
  }
  Object.assign(proposal,{status:input.action==='approve'?'APPROVED':'REJECTED',reviewedBy:actor.uid,reviewedAt:at,reusableAlias:Boolean(input.reusableAlias),...(input.evidenceUrl?{evidenceUrl:https(input.evidenceUrl)}:{})});
  tx.update(receiptRef,{analysis:{...record(receipt.analysis),relationships},identityProposals:proposals});
  if(input.action==='approve'){
   const count=new Set(relationships.filter(r=>r.sourceId&&r.targetId&&r.confidence>=.7).map(r=>[r.sourceId,r.targetId,r.type].join('|'))).size;
   tx.update(sourceRef,{newsAnalysis:{...record(source.newsAnalysis),candidateCount:count,identityReviewedAt:at}});
  }
  if(candidateRef&&candidate)tx.create(candidateRef,candidate);
  return {status:proposal.status,reusableAlias:Boolean(input.reusableAlias)};
 });
}
