import {getAdminFirestore} from '../firebase/admin';
import type {Firestore} from 'firebase-admin/firestore';
import {createHierarchyBrowser,hierarchyCompanyRows,type BrowseKind} from './company-directory';
import type {HierarchyNode} from './model';
export type {BrowseCompany} from './company-directory';

// Share refresh work across separately bundled routes, scoped to the database.
declare global {var __hierarchyBrowsersV1:WeakMap<Firestore,ReturnType<typeof createHierarchyBrowser>>|undefined;}
const browsers=globalThis.__hierarchyBrowsersV1??=new WeakMap();
export async function browseCompanies(kind:BrowseKind,nodes:HierarchyNode[]){
  try{
    const db=getAdminFirestore();
    let browse=browsers.get(db);
    if(!browse){browse=createHierarchyBrowser((kind,nodes)=>hierarchyCompanyRows(db,kind,nodes));browsers.set(db,browse);}
    return await browse(kind,nodes);
  }catch{return {items:[],unavailable:true};}
}
