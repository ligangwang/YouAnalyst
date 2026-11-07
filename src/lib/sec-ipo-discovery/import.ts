import {createHash} from 'node:crypto';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {normalizedCik} from '../industry-classification/sec';
import {instrumentFromCompany,instrumentId,validateInstrument,type Instrument} from '../instruments/model';
import {createSecIpoOnboardingRequest,ONBOARDING_COLLECTION,parseOnboardingRequest} from '../instrument-onboarding/model';
import {onboardingSummary} from '../instrument-onboarding/queue';
import {isSupportedCompany} from '../company-support/model';
import {SEC_IPO_COLLECTION,symbolKey,type Filing,type Listing} from './evidence';

export class IpoIdentityReview extends Error {}
export const listingClaimId=(listing:Listing)=>'listing_'+createHash('sha256').update(`${listing.cik}:${listing.exchangeMic}:${listing.symbol}`).digest('hex');

/** Company, listing claims and onboarding intent commit together, so retries cannot orphan work. */
export async function importConfirmedIpo(db:Firestore,listing:Listing,filings:Filing[],now=Date.now()){
  if(!/^\d{10}$/.test(listing.cik)||Number(listing.cik)===0||!['XNAS','XNYS','XASE'].includes(listing.exchangeMic)||!listing.name.trim()||!/^[A-Z0-9][A-Z0-9.]{0,15}$/.test(listing.symbol))throw Error('Invalid confirmed listing');
  if(!filings.length||filings.some(f=>f.cik!==listing.cik||!f.primaryDocument||!['424B4','424B1'].includes(f.form)))throw Error('Missing confirmed prospectus evidence');
  const registry=db.collection(SEC_IPO_COLLECTION),issuerRef=registry.doc(`issuer_${listing.cik}`),claimRef=registry.doc(listingClaimId(listing));
  const legacy=`US:${listing.symbol}`,id=instrumentId(legacy),sourceRef=db.collection('companies').doc(legacy),instRef=db.collection('instruments').doc(id),requestRef=db.collection(ONBOARDING_COLLECTION).doc(id);
  return db.runTransaction(async tx=>{
    const [issuer,claim,source,inst,request]=await tx.getAll(issuerRef,claimRef,sourceRef,instRef,requestRef);
    const bare=String(Number(listing.cik));
    const variants=[Number(bare),...Array.from({length:11-bare.length},(_,i)=>bare.padStart(bare.length+i,'0'))];
    const matches=await tx.get(db.collection('companies').where('cik','in',variants));
    const records=new Map(matches.docs.map(doc=>[doc.id,doc.data()]));if(source.exists)records.set(source.id,source.data()!);
    const owners=new Set<string>();
    for(const [key,row] of records){
      if(normalizedCik(row.cik)!==listing.cik)throw new IpoIdentityReview('Ticker belongs to another or unknown CIK');
      if(row.isDeleted||row.listingStatus==='PRIVATE')throw new IpoIdentityReview('Existing issuer is private or deleted');
      if(key.startsWith('US:')&&key!==legacy&&(symbolKey(key.slice(3))===listing.symbol||typeof row.symbol==='string'&&symbolKey(row.symbol)===listing.symbol))throw new IpoIdentityReview('Existing listing notation or symbol history requires review');
      owners.add(typeof row.supersededByCompanyId==='string'?row.supersededByCompanyId:key);
    }
    if(issuer.exists)owners.add(String(issuer.get('companyId')));
    if(inst.exists)owners.add(String(inst.get('companyId')));
    if(owners.size>1)throw new IpoIdentityReview('Multiple issuer identities require review');
    const companyId=[...owners][0]??legacy;
    if(!companyId||companyId.includes('/'))throw new IpoIdentityReview('Invalid issuer claim');
    const ownerRef=db.collection('companies').doc(companyId),owner=await tx.get(ownerRef);
    if(owner.exists&&(normalizedCik(owner.get('cik'))!==listing.cik||owner.get('supersededByCompanyId')||owner.get('isDeleted')||owner.get('listingStatus')==='PRIVATE'||!['DIRECTORY','PUBLISHED'].includes(owner.get('status'))))throw new IpoIdentityReview('Issuer is not eligible for automatic onboarding');
    if(!owner.exists&&companyId!==legacy)throw new IpoIdentityReview('Issuer claim references a missing company');
    if(claim.exists&&(claim.get('companyId')!==companyId||claim.get('instrumentId')!==id))throw new IpoIdentityReview('Listing identity claim conflict');
    const at=new Date(now).toISOString(),stamp=Timestamp.fromMillis(now);
    const fresh={name:listing.name,symbol:listing.symbol,cik:listing.cik,status:'DIRECTORY',market:'US',micCode:listing.exchangeMic,exchange_region:'US',source:'SEC IPO discovery',lastSyncedAt:at};
    const company:Record<string,unknown>=owner.exists?owner.data()!:fresh;
    const record=inst.exists?validateInstrument(inst.data() as Instrument):instrumentFromCompany(legacy,source.exists?source.data()!:fresh,companyId)!;
    if(record.companyId!==companyId||record.symbol!==listing.symbol||record.providerSymbols.youanalyst!==legacy||record.exchangeMic&&record.exchangeMic!==listing.exchangeMic||record.status==='DELISTED'||(inst.exists&&inst.get('isDeleted')))throw new IpoIdentityReview('Existing instrument identity requires review');
    if(request.exists){const current=parseOnboardingRequest(request.data());if(current.companyId!==companyId||current.instrumentId!==id)throw new IpoIdentityReview('Onboarding identity mismatch');}
    const enqueue=!request.exists&&!(isSupportedCompany(company)&&record.onboarding?.status==='SUPPORTED');
    const intent=enqueue?createSecIpoOnboardingRequest(id,record,company,new Date(now)):null;
    if(!owner.exists)tx.create(ownerRef,{...fresh,createdAt:stamp,updatedAt:stamp,...(intent?{onboarding:onboardingSummary('QUEUED',now,at)}:{})});
    if(!source.exists&&companyId!==legacy)tx.create(sourceRef,{...fresh,supersededByCompanyId:companyId,createdAt:stamp,updatedAt:stamp});
    if(!inst.exists)tx.create(instRef,{...record,exchangeMic:listing.exchangeMic,createdAt:stamp,updatedAt:stamp,...(intent?{onboarding:onboardingSummary('QUEUED',now,at)}:{})});
    else if(intent)tx.update(instRef,{onboarding:onboardingSummary('QUEUED',now,at),updatedAt:stamp});
    if(intent){tx.create(requestRef,intent);if(owner.exists&&!isSupportedCompany(company)&&!company.onboarding)tx.update(ownerRef,{onboarding:onboardingSummary('QUEUED',now,at),updatedAt:stamp});}
    if(!issuer.exists)tx.create(issuerRef,{kind:'ISSUER',cik:listing.cik,companyId,firstSeenAt:at});
    if(!claim.exists)tx.create(claimRef,{kind:'LISTING',cik:listing.cik,symbol:listing.symbol,exchangeMic:listing.exchangeMic,companyId,instrumentId:id,filings,status:'CONFIRMED',firstSeenAt:at});
    return {companyId,instrumentId:id,created:!inst.exists,queued:enqueue};
  });
}
