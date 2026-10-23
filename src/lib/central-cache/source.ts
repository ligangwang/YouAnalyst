import { themeIdBatches } from '../company-themes/company-query';
import { FieldPath, Timestamp, type Firestore, type Query, type DocumentData } from 'firebase-admin/firestore';
import type { Collection, Row, Source, Stamp } from './store';
import {withLiveCompanyReads} from '../local-cache/company-directory';
const stamp=(value:Stamp)=>new Timestamp(value.seconds,value.nanoseconds);
const row=(doc:{id:string;data():DocumentData|undefined}):Row=>({id:doc.id,data:doc.data()!});
export function firestoreSource(db:Firestore):Source {
  const read=async(query:Query)=>withLiveCompanyReads(async()=>{const rows:Row[]=[];let cursor;
    for(;;){const page=await (cursor?query.startAfter(cursor):query).limit(200).get();rows.push(...page.docs.map(row));if(page.size<200)break;cursor=page.docs.at(-1)!;}return rows;});
  const documents=async(collection:Collection,ids:string[])=>withLiveCompanyReads(async()=>{const rows:Row[]=[];for(let i=0;i<ids.length;i+=100){const docs=await db.getAll(...ids.slice(i,i+100).map(id=>db.collection(collection).doc(id)));rows.push(...docs.filter(d=>d.exists).map(row));}return rows;});
  let knownThemeIds=new Set<string>();
  const companyRows=async(query:Query,batches?:string[][])=>{const rows=new Map<string,Row>();for(const ids of batches??await themeIdBatches(db))for(const row of await read(query.where('themeIds','array-contains-any',ids)))rows.set(row.id,row);return [...rows.values()];};
  return {
    boundary:async()=>withLiveCompanyReads(async()=>{const doc=await db.collection('companies').limit(1).get();return {seconds:doc.readTime.seconds,nanoseconds:doc.readTime.nanoseconds};}),
    initial:async(collection,ids)=>{
      if(collection==='companies'){const batches=await themeIdBatches(db);const rows=await companyRows(db.collection(collection).orderBy(FieldPath.documentId()),batches);knownThemeIds=new Set(batches.flat());return rows;}
      return collection==='company_fundamentals'?documents(collection,ids):read(db.collection(collection).orderBy(FieldPath.documentId()));
    },
    changes:async(collection,since,through)=>{
      const base=db.collection(collection).where('updatedAt','>=',stamp(since)).where('updatedAt','<=',stamp(through)).orderBy('updatedAt').orderBy(FieldPath.documentId());
      const rows:Row[]=[];
      let currentThemeIds:Set<string>|undefined;
      if(collection==='companies'){
        const batches=await themeIdBatches(db);currentThemeIds=new Set(batches.flat());
        rows.push(...await companyRows(base,batches));
        // Publishing a theme can enroll unchanged company documents into this reader.
        const added=[...currentThemeIds].filter(id=>!knownThemeIds.has(id));
        for(let i=0;i<added.length;i+=30)rows.push(...await companyRows(db.collection(collection).orderBy(FieldPath.documentId()),[added.slice(i,i+30)]));
      }
      // Firestore disallows document-ID equality combined with timestamp ranges.
      // Read only changed rows; the cache engine keeps enrolled fundamentals.
      else rows.push(...await read(base));
      // Durable tombstones in the existing collectors collection survive deployment
      // overlap. Re-read affected IDs so recreation always wins over an old deletion.
      const deleted=await read(db.collection('collectors').where('cacheDeletedCollection','==',collection).where('updatedAt','>=',stamp(since)).where('updatedAt','<=',stamp(through)).orderBy('updatedAt').orderBy(FieldPath.documentId()));
      const deletedIds=deleted.map(row=>String(row.data.sourceId));
      const restored=new Map((await documents(collection,deletedIds)).map(row=>[row.id,row]));
      for(const id of deletedIds)rows.push(restored.get(id)??{id,data:{},deleted:true});
      if(currentThemeIds)knownThemeIds=currentThemeIds;
      return rows;
    },documents,
  };
}
