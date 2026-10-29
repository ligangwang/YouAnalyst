import { FieldPath, type Firestore, type Query, type Timestamp } from 'firebase-admin/firestore';
import type { Row, Source, Collection } from './sync';
import {withLiveCompanyReads} from '../local-cache/company-directory';

export function snapshotSource(db: Firestore): Source {
  async function* pages(collection:Collection,since:Timestamp|undefined,through:Timestamp):AsyncGenerator<Row[]> {
      let query: Query=db.collection(collection);
      query=since?query.where('updatedAt','>=',since).where('updatedAt','<=',through).orderBy('updatedAt').orderBy(FieldPath.documentId()):query.orderBy(FieldPath.documentId());
      let cursor: unknown[] | undefined;
      for(;;){
        const page=await withLiveCompanyReads(()=>(cursor?query.startAfter(...cursor):query).limit(250).get());
        const docs=page.docs;
        yield docs.filter(doc=>!doc.id.startsWith('_')).map(doc=>({id:doc.id,data:doc.data()}));
        if(page.size<250)break;
        const last=docs[docs.length-1];
        cursor=since?[last.get('updatedAt'),last.id]:[last.id];
      }
  }
  return {
    boundary:async()=>withLiveCompanyReads(async()=>(await db.collection('companies').limit(1).get()).readTime),
    pages,
    rows:async(collection,since,through)=>{
      const rows:Row[]=[];
      for await(const page of pages(collection,since,through))rows.push(...page);
      return rows;
    },
  };
}
