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
      let cursor: unknown[] | undefined;
      for(;;){
        // Reuse the base query and scalar cursor, without retaining prior SDK
        // snapshots or accumulating cursor clauses across the full directory.
        const page=await (cursor?query.startAfter(...cursor):query).limit(250).get();
        const docs=page.docs;
        for(const doc of docs)if(!doc.id.startsWith('_'))rows.push({id:doc.id,data:doc.data()});
        if(page.size<250)break;
        const last=docs[docs.length-1];
        cursor=since?[last.get('updatedAt'),last.id]:[last.id];
      }
      return rows;
    },
  };
}
