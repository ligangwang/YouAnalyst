import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import { collectionSourceSnapshot } from '../local-cache/read-scope';
import { loadCompanyDocuments } from '../company-document-cache';
import { graphFromMarket,relationshipId, type MarketCompany, type MarketRelationship } from './market-store';
import { relationshipBelongsToTheme } from './relationship-cache';
import { NVIDIA_MANUFACTURING_FACTS,NVIDIA_EDITORIAL_COMPANIES } from '../research/nvidia-manufacturing';
import {projectNvidiaManufacturing} from './nvidia-manufacturing-projection';
import {themedGraph} from '../company-themes/presentation';
import {isCollectionCompany,type ThemedCompany} from '../company-themes/model';
import type {ThemeCatalog} from '../company-themes/catalog-model';

/** Complete direct neighborhood, with the same publication rules as the map.
 * Single-field endpoint queries require no new index and never truncate edges. */
export async function loadCompanyNeighborhood(db: Firestore, id: string, data: Record<string, unknown> | undefined, options:{theme?:string;catalog?:ThemeCatalog}={}) {
  const theme=options.theme??'ai';
  const enrolled=(company:ThemedCompany)=>company.themeIds?.includes(theme)&&isCollectionCompany(company)&&company.themeMemberships?.[theme]?.status==='PUBLISHED';
  if(theme!=='ai'&&(!data||!enrolled({...data,id})))return {nodes:[],relationships:[],sources:[],asOf:''};
  const editorial=theme==='ai'?NVIDIA_MANUFACTURING_FACTS.filter(fact=>id==='US:NVDA'||fact.source===id):[];
  const queries=['source', 'target'].map(field=>db.collection('company_relationships').where(field,'==',id));
  // A changed endpoint must not hide an exact-key withdrawal from the projection.
  if(editorial.length)queries.push(db.collection('company_relationships').where(FieldPath.documentId(),'in',editorial.map(({source})=>relationshipId(source,'US:NVDA','SUPPLIER_OF'))));
  const snapshots = await Promise.all(queries.map(async query => {
    return await (collectionSourceSnapshot(db, query, 'company_relationships') ?? query.get());
  }));
  const records = new Map<string, MarketRelationship>();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    const row = { ...doc.data(), id: doc.id } as MarketRelationship;
    records.set(doc.id,row);
  }
  const published=(row:MarketRelationship)=>row.isDeleted!==true&&row.status==='PUBLISHED'&&relationshipBelongsToTheme(row,theme);
  const ids = [...new Set([...records.values()].filter(row=>published(row)&&(row.source===id||row.target===id)).flatMap(row => [row.source, row.target]).concat(editorial.length?['US:NVDA',...editorial.map(fact=>fact.source)]:[]))]
    .filter(neighbor => neighbor !== id && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(neighbor));
  // Share the existing ID-batch push cache instead of opening a separate stream
  // per neighbor. It retains missing/deleted records and live withdrawals too.
  // Distinguish a missing editorial identity from a live tombstone: only the
  // former permits the source-controlled fallback. Ordinary neighbors still
  // use the shared ID-batch cache, which intentionally hides tombstones.
  const editorialIds=NVIDIA_EDITORIAL_COMPANIES.map(company=>company.id).filter(key=>editorial.some(fact=>fact.source===key));
  const rawIdentities=async()=>{
    if(!editorialIds.length)return [];
    const query=db.collection('companies').where(FieldPath.documentId(),'in',editorialIds);
    return (await(collectionSourceSnapshot(db,query,'companies')??query.get())).docs;
  };
  const [neighbors,identities]=await Promise.all([loadCompanyDocuments(db, 'companies', ids.filter(key=>!editorialIds.includes(key))),rawIdentities()]);
  let companies = neighbors.filter(doc => doc.exists).map(doc => ({ ...doc.data(), id: doc.id }) as MarketCompany);
  for(const doc of identities)companies.push({...doc.data(),id:doc.id} as MarketCompany);
  if (data&&!companies.some(company=>company.id===id)) companies.push({ ...data, id } as MarketCompany);
  let selected=[...records.values()];
  if(editorial.length){const projection=projectNvidiaManufacturing(companies,selected,editorial.map(fact=>fact.source));companies=projection.companies;selected=projection.records;}
  selected=selected.filter(row=>published(row)&&(row.source===id||row.target===id));
  const needed=new Set([id,...selected.flatMap(row=>[row.source,row.target])]);
  companies=companies.filter(company=>needed.has(company.id)&&company.isDeleted!==true);
  if(theme!=='ai')return themedGraph(theme,(companies as ThemedCompany[]).filter(enrolled),selected,options.catalog);
  return graphFromMarket(companies, selected);
}
