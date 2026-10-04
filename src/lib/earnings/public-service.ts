import {getAdminFirestore} from '../firebase/admin';
import {latestPublicEarnings,type PublicEarningsSummary} from './public-summary';
import type {EarningsRecord} from './model';

const cache=new Map<string,{expires:number;value:Promise<PublicEarningsSummary|null>}>();
/** Read existing immutable revisions and their current heads; never request providers on a page read. */
export async function loadLatestCompanyEarnings(companyId:string):Promise<PublicEarningsSummary|null>{
  if(!/^(?:US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHE:[03]\d{5}|XSHG:6\d{5})$/.test(companyId))return null;
  const previous=cache.get(companyId);if(previous&&previous.expires>Date.now())return previous.value;
  const value=(async()=>{
    try{
      const db=getAdminFirestore(),collection=db.collection('earnings_records');
      const page=await collection.where('companyId','==',companyId).get();
      const records=page.docs.filter(doc=>doc.get('recordType')==='revision').map(doc=>doc.get('record') as EarningsRecord).filter(record=>Boolean(record?.eventId&&record.revisionId));
      const heads=new Map<string,string>();
      const ids=[...new Set(records.map(record=>record.eventId))];
      for(let offset=0;offset<ids.length;offset+=100){
        const docs=await db.getAll(...ids.slice(offset,offset+100).map(id=>collection.doc(`head_${id}`)));
        docs.forEach((doc,index)=>{const revision=doc.get('revisionId');if(typeof revision==='string')heads.set(ids[offset+index],revision);});
      }
      return latestPublicEarnings(records,heads,companyId);
    }catch(error){console.error('Company earnings summary unavailable',companyId,error);return null;}
  })();
  if(cache.size>200)cache.clear();cache.set(companyId,{expires:Date.now()+60_000,value});return value;
}
