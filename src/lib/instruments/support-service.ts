import {createHash} from 'node:crypto';
import {publishedSupportedInstruments} from '../market-store/runtime';
import type {Firestore} from 'firebase-admin/firestore';
import {getAdminFirestore} from '../firebase/admin';
import {loadSupportedCompanies} from '../company-support/service';
import {supportedCompanyUniverse} from '../company-support/model';
import type {ThemedCompany} from '../company-themes/model';
import {predictionInstrument} from '../predictions/instrument';
import {localQuery} from '../local-cache/entities';
import {isSupportedInstrument} from './support';
import type {Instrument} from './model';
import type {KnowledgeGraph} from '../knowledge-graph/model';

export async function loadSupportedInstrumentUniverse(db:Firestore=getAdminFirestore()):Promise<KnowledgeGraph>{
  const published=await publishedSupportedInstruments(db);
  const readLegacy=async()=>{
    const query=db.collection('instruments').where('onboarding.status','==','SUPPORTED');
    const docs=typeof db.collection('instruments').onSnapshot==='function'
      ? [...(await localQuery(db,'instruments:supported',query,'instruments')).values()] : (await query.get()).docs;
    return docs.map(doc=>({id:doc.id,data:doc.data()}));
  };
  const [issuers,records]=await Promise.all([loadSupportedCompanies(db,undefined,'universe'),published??readLegacy()]);
  const companies=new Map(issuers.map(doc=>[doc.id,{...doc.data(),id:doc.id} as ThemedCompany]));
  const nodes=records.flatMap(row=>{
    const record=row.data as Instrument,company=companies.get(record.companyId);
    if(!company||!isSupportedInstrument(record,company))return [];
    const listing=record.providerSymbols?.youanalyst;if(typeof listing!=='string')return [];
    const target=predictionInstrument(listing.startsWith('US:')?listing.slice(3):listing);if(!target)return [];
    const node=supportedCompanyUniverse([company]).nodes[0];
    return [{...node,id:listing,symbol:record.symbol,market:target.market}];
  });
  console.info(JSON.stringify({event:'eod_supported_instrument_universe',source:published?'parquet':'legacy',
    instruments:records.length,instrumentIdHash:createHash('sha256').update(JSON.stringify(records.map(r=>r.id).sort())).digest('hex'),
    listings:nodes.length,listingIdHash:createHash('sha256').update(JSON.stringify(nodes.map(n=>n.id).sort())).digest('hex')}));
  return {nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id)),relationships:[],sources:[],asOf:''};
}
