import { validateThemeCatalog } from '../../src/lib/company-themes/catalog-model';
import { company, type Document, type Request } from './firestore-rest';
import assert from 'node:assert/strict';

export async function readThemeCatalog(root:string,request:Request) {
  const rows=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'investment_themes'}],where:{fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:{stringValue:'PUBLISHED'}}},limit:2001}}) as {document?:Document}[];
  assert(rows.filter(row=>row.document).length<=2000,'Theme catalog exceeds safe size');
  return validateThemeCatalog(rows.flatMap(row=>row.document?[company(row.document)]:[]).filter(row=>!row.isDeleted).map(row=>({id:row.id,parentId:row.parentId as string|null,names:row.names as {en:string;'zh-CN':string},order:row.order as number})));
}
