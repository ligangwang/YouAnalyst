import type {DocumentData,Query} from 'firebase-admin/firestore';

/** Server-side paging: complete period totals without sending full records to browsers. */
export async function readPeriodDocuments(query:Query<DocumentData>){
  const docs=[];
  const pageSize=500;
  for(;;){
    const page=await query.limit(pageSize).get();
    docs.push(...page.docs);
    if(page.size<pageSize)return docs;
    query=query.startAfter(page.docs[page.docs.length-1]);
  }
}
