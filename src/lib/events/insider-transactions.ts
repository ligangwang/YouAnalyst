import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {EventClassification} from './classification';
export type InsiderTransaction={ownerId:string;ownerName:string;date:string;code:string;security:string;shares:string;price:string;direction:string;derivative:boolean};
export type InsiderEventGroup=EventClassification&{eventGroupingKey:string;transactions:InsiderTransaction[];amendment:boolean};
const list=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value as Record<string,unknown>[]:value&&typeof value==='object'?[value as Record<string,unknown>]:[];
const value=(input:unknown):string=>typeof input==='object'&&input!==null?value((input as Record<string,unknown>).value):typeof input==='string'?input.trim():'';
const day=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const codes:Record<string,string>={P:'insider_buy',S:'insider_sell',A:'insider_award',M:'insider_exercise',C:'insider_exercise',X:'insider_exercise',O:'insider_exercise',F:'insider_withholding',G:'insider_gift'};
export function validInsiderGroup(group:InsiderEventGroup,companyId:string):boolean {
 if(!group||group.eventType!=='insider_trade'||group.eventClassification?.version!==1||!Array.isArray(group.transactions)||!group.transactions.length)return false;
 return group.transactions.every(t=>t&&typeof t.ownerId==='string'&&/^\d+(?:\+\d+)*$/.test(t.ownerId)&&typeof t.ownerName==='string'&&day(t.date)&&typeof t.security==='string'&&typeof t.shares==='string'&&/^\d+(?:\.\d+)?$/.test(t.shares)&&typeof t.price==='string'&&['A','D'].includes(t.direction)&&typeof t.derivative==='boolean'&&/^[A-Z]$/.test(t.code)&&!(t.code==='P'&&t.direction!=='A'||t.code==='S'&&t.direction!=='D')&&group.eventSubtype===(codes[t.code]??'insider_ownership')&&group.eventGroupingKey===JSON.stringify(['insider',companyId,t.ownerId,t.date,group.eventSubtype,t.security.normalize('NFKC').toLowerCase(),t.derivative]));
}
/** Read transaction rows, not acquired/disposed direction alone. Never resolve footnotes with guesses. */
export function parseInsiderTransactions(xml:string,companyId:string):InsiderEventGroup[]{
 if(xml.length>2_000_000||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid ownership XML');
 const root=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false}).parse(xml).ownershipDocument;
 if(!root||!['4','4/A','5','5/A'].includes(root.documentType)||!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(companyId))throw new Error('Unsupported ownership document');
 const ticker=value(root.issuer?.issuerTradingSymbol).toUpperCase();
 if(ticker!==companyId.slice(3))throw new Error('Ownership issuer mismatch');
 const owners=list(root.reportingOwner).map(owner=>{const id=owner.reportingOwnerId as Record<string,unknown>|undefined;return {id:value(id?.rptOwnerCik).replace(/^0+/,''),name:value(id?.rptOwnerName)};});
 if(!owners.length||owners.some(owner=>!/^\d+$/.test(owner.id)||!owner.name))throw new Error('Missing reporting owner');
 // Co-reporters form one identity; do not duplicate the same economic transaction for each owner.
 const ownerId=owners.map(owner=>owner.id).sort().join('+'),ownerName=owners.map(owner=>owner.name).join(' / ');
 const groups=new Map<string,InsiderEventGroup>();
 for(const derivative of [false,true]){
  const table=root[derivative?'derivativeTable':'nonDerivativeTable'];
  for(const row of list(table?.[derivative?'derivativeTransaction':'nonDerivativeTransaction'])){
   const coding=row.transactionCoding as Record<string,unknown>|undefined,amounts=row.transactionAmounts as Record<string,unknown>|undefined;
   const code=value(coding?.transactionCode),date=value(row.transactionDate),security=value(row.securityTitle),shares=value(amounts?.transactionShares),price=value(amounts?.transactionPricePerShare),direction=value(amounts?.transactionAcquiredDisposedCode);
   if(!day(date)||!security||!/^[A-Z]$/.test(code)||!['A','D'].includes(direction)||!/^\d+(?:\.\d+)?$/.test(shares))throw new Error('Incomplete ownership transaction');
   if(code==='P'&&direction!=='A'||code==='S'&&direction!=='D')throw new Error('Conflicting ownership transaction');
   const eventSubtype=codes[code]??'insider_ownership';
   const key=JSON.stringify(['insider',companyId,ownerId,date,eventSubtype,security.normalize('NFKC').toLowerCase(),derivative]);
   const transaction:InsiderTransaction={ownerId,ownerName,date,code,security,shares,price,direction,derivative};
   const group=groups.get(key);
   if(group)group.transactions.push(transaction);
   else groups.set(key,{eventType:'insider_trade',eventSubtype,eventClassification:{version:1,method:'parser',rule:'sec.ownership.transaction_code',evidence:[`Form ${root.documentType}; transaction code ${code}`]},eventGroupingKey:key,transactions:[transaction],amendment:root.documentType.endsWith('/A')});
  }
 }
 if(groups.size>100)throw new Error('Too many transaction groups');
 return [...groups.values()];
}
