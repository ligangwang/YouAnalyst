import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {catalogThemes} from './catalog-model';
import {loadThemeCatalog} from './catalog';
import {catalogGraphSectors} from './catalog-graph';
import {themeFields,themeVersion,type ThemeAssignment} from './classification';
import type {ThemedCompany} from './model';

export class ThemeEditConflict extends Error{}
export async function readThemeEditor(db:Firestore,id:string){
  const [doc,catalog]=await Promise.all([db.collection('companies').doc(id).get(),loadThemeCatalog(db)]);
  if(!doc.exists||doc.get('isDeleted')||!['DIRECTORY','PUBLISHED'].includes(doc.get('status')))throw Error('Company unavailable');
  const company=doc.data()!;
  return {version:themeVersion(company),themes:catalogThemes(catalog).map(t=>{
    const roles=[...new Set(catalogGraphSectors(catalog,t.id).flatMap(s=>[s.id,...s.stages]))];
    const roleNames=Object.fromEntries(roles.map(role=>{const normalized=role.replace(`${t.id}:`,'');const node=catalog.find(n=>n.id===normalized||n.id===`${t.id}.${normalized}`)||catalog.find(n=>n.id.startsWith(`${t.id}.`)&&n.id.split('.').at(-1)===normalized);return [role,node?.names??{en:role,'zh-CN':role}];}));
    return {id:t.id,names:t.names,roles,roleNames};
  }),assignments:Object.entries(company.themeMemberships??{}).filter(([,v])=>(v as {status:string}).status==='PUBLISHED').map(([theme,value])=>{const m=value as ThemeAssignment;return {theme,primarySector:m.primarySector,secondaryRoles:m.secondaryRoles??[],sources:m.sources??[],...(theme==='ai'?{aiStageIds:(company.inGraph as {stageIds?:string[]})?.stageIds??[]}:{} )};})};
}
export async function editCompanyThemes(db:Firestore,id:string,version:string,assignments:ThemeAssignment[]){
  const catalog=await loadThemeCatalog(db);
  return db.runTransaction(async tx=>{
    const ref=db.collection('companies').doc(id),doc=await tx.get(ref),company=doc.data();
    if(!company||company.isDeleted||company.supersededByCompanyId||!['DIRECTORY','PUBLISHED'].includes(company.status))throw Error('Company unavailable');
    if(themeVersion(company)!==version)throw new ThemeEditConflict('Company changed; reload before saving');
    const fields=themeFields({...company,id} as ThemedCompany,catalog,assignments,String(company.description??assignments?.[0]?.sources?.[0]?.summary??''),true);
    tx.update(ref,{...fields,updatedAt:Timestamp.now()});
    return {themeIds:fields.themeIds};
  });
}
