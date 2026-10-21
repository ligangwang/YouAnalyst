import { FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';
import type { Row, Source } from './sync';

export function snapshotSource(db: Firestore): Source {
  return {
    boundary:async()=>(await db.collection('companies').limit(1).get()).readTime,
    rows:async(collection,since,through)=>{
      let query: Query=db.collection(collection);
      // Inclusive boundary replays equal timestamps safely. No theme filter:
      // these files represent all entities, including the public directory.
      query=since?query.where('updatedAt','>=',since).where('updatedAt','<=',through).orderBy('updatedAt').orderBy(FieldPath.documentId()):query.orderBy(FieldPath.documentId());
      const rows: Row[]=[];
      for(;;){
        const page=await query.limit(250).get();
        for(const doc of page.docs)if(!doc.id.startsWith('_'))rows.push({id:doc.id,data:doc.data()});
        if(page.size<250)break;
        query=query.startAfter(page.docs[page.docs.length-1]);
      }
      return rows;
    },
  };
}
