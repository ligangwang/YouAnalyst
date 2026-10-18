import { FieldPath, Timestamp, type Firestore, type Query, type DocumentData } from 'firebase-admin/firestore';
import type { Collection, Row, Source, Stamp } from './store';
const stamp=(value:Stamp)=>new Timestamp(value.seconds,value.nanoseconds);
const row=(doc:{id:string;data():DocumentData|undefined}):Row=>({id:doc.id,data:doc.data()!});
export function firestoreSource(db:Firestore):Source {
  const read=async(query:Query)=>{const rows:Row[]=[];let cursor;
    for(;;){const page=await (cursor?query.startAfter(cursor):query).limit(200).get();rows.push(...page.docs.map(row));if(page.size<200)break;cursor=page.docs.at(-1)!;}return rows;};
  const documents=async(collection:Collection,ids:string[])=>{const rows:Row[]=[];for(let i=0;i<ids.length;i+=100){const docs=await db.getAll(...ids.slice(i,i+100).map(id=>db.collection(collection).doc(id)));rows.push(...docs.filter(d=>d.exists).map(row));}return rows;};
  return {
    boundary:async()=>{const doc=await db.collection('collectors').doc('_read_cache_versions_v1').get();return {seconds:doc.readTime.seconds,nanoseconds:doc.readTime.nanoseconds};},
    initial:async(collection,ids)=>collection==='companies'?read(db.collection(collection).where('themeIds','array-contains-any',['ai','robotics','space']).orderBy(FieldPath.documentId())):collection==='company_fundamentals'?documents(collection,ids):read(db.collection(collection).orderBy(FieldPath.documentId())),
    changes:async(collection,since,through)=>{
      const base=db.collection(collection).where('cacheUpdatedAt','>=',stamp(since)).where('cacheUpdatedAt','<=',stamp(through)).orderBy('cacheUpdatedAt').orderBy(FieldPath.documentId());
      const rows:Row[]=[];
      if(collection==='companies')rows.push(...await read(base.where('themeIds','array-contains-any',['ai','robotics','space'])));
      // Firestore disallows document-ID equality combined with timestamp ranges.
      // Read only changed rows; the cache engine keeps enrolled fundamentals.
      else rows.push(...await read(base));
      // Durable tombstones in the existing collectors collection survive deployment
      // overlap. Re-read affected IDs so recreation always wins over an old deletion.
      const deleted=await read(db.collection('collectors').where('cacheDeletedCollection','==',collection).where('cacheUpdatedAt','>=',stamp(since)).where('cacheUpdatedAt','<=',stamp(through)).orderBy('cacheUpdatedAt').orderBy(FieldPath.documentId()));
      const deletedIds=deleted.map(row=>String(row.data.sourceId));
      const restored=new Map((await documents(collection,deletedIds)).map(row=>[row.id,row]));
      for(const id of deletedIds)rows.push(restored.get(id)??{id,data:{},deleted:true});
      return rows;
    },documents,
  };
}
