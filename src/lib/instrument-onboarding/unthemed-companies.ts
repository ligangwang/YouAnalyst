import type {Firestore} from 'firebase-admin/firestore';
import {isSupportedCompany} from '../company-support/model';
import {isCollectionCompany} from '../company-themes/model';
import {companyPageUrl} from '../market-companies/routes';
import {withLiveCompanyReads} from '../local-cache/company-directory';

export type SupportedUnthemedCompany={id:string;name:string;symbol:string;market:string;href:string;instruments:{id:string;symbol:string;status:string}[]};
export const validCompanyCursor=(value:string)=>/^[A-Za-z0-9:._-]{1,160}$/.test(value);

/** Company admission and instrument admission are independent. Include issuers
 * without request documents, and use only existing single-field indexes. */
export async function listSupportedUnthemedCompanies(db:Firestore,cursor?:string){
 if(cursor&&!validCompanyCursor(cursor))throw Error('Invalid company cursor');
 return withLiveCompanyReads(async()=>{
  const companies:SupportedUnthemedCompany[]=[];let after=cursor,scanned=0,nextCursor:string|null=null;
  while(companies.length<25&&scanned<500){
   let query=db.collection('companies').where('onboarding.status','==','SUPPORTED').orderBy('__name__').limit(100);
   if(after)query=query.startAfter(after);
   const page=await query.get();if(!page.docs.length){nextCursor=null;break;}
   for(let i=0;i<page.docs.length;i++){
    const doc=page.docs[i],company=doc.data();after=doc.id;scanned++;
    if(isSupportedCompany(company)&&!isCollectionCompany({...company,id:doc.id})){
     const market=doc.id.startsWith('US:')?'US':/^(XSHG|XSHE):/.test(doc.id)?'CN_A':'GLOBAL';
     const instruments=await db.collection('instruments').where('companyId','==',doc.id).limit(50).get();
     companies.push({id:doc.id,name:String(company.name),symbol:String(company.symbol??doc.id.split(':')[1]??''),market,href:companyPageUrl(doc.id,market,company.slug),
      instruments:instruments.docs.filter(row=>row.get('isDeleted')!==true).map(row=>({id:row.id,symbol:String(row.get('symbol')??row.id),status:String(row.get('onboarding')?.status??'DIRECTORY')}))});
    }
    nextCursor=i<page.docs.length-1||page.docs.length===100?after:null;
    if(companies.length===25||scanned===500)break;
   }
   if(!nextCursor)break;
  }
  return {items:[],companies,nextCursor};
 });
}
