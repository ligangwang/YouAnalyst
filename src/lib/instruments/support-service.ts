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
  const query=db.collection('instruments').where('onboarding.status','==','SUPPORTED');
  const [issuers,records]=await Promise.all([loadSupportedCompanies(db,undefined,'universe'),typeof db.collection('instruments').onSnapshot==='function'
    ?localQuery(db,'instruments:supported',query,'instruments').then(rows=>[...rows.values()]):query.get().then(page=>page.docs)]);
  const companies=new Map(issuers.map(doc=>[doc.id,{...doc.data(),id:doc.id} as ThemedCompany]));
  const nodes=records.flatMap(doc=>{
    const record=doc.data() as Instrument,company=companies.get(record.companyId);
    if(!company||!isSupportedInstrument(record,company))return [];
    const listing=record.providerSymbols?.youanalyst;if(typeof listing!=='string')return [];
    const target=predictionInstrument(listing.startsWith('US:')?listing.slice(3):listing);if(!target)return [];
    const node=supportedCompanyUniverse([company]).nodes[0];
    return [{...node,id:listing,symbol:record.symbol,market:target.market}];
  });
  return {nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id)),relationships:[],sources:[],asOf:''};
}
