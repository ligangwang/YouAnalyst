import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { fundamentalsVersion, parseFundamentalsRequest, publishFundamentalsMessage, type FundamentalsRequest } from './pubsub';
import { usFundamentalsId } from './identity';

/** Reuse durable progress and filing context; only the admin can release a saved failure. */
export async function rerunFundamentalsBatch(db: Firestore, batchId: string, uid: string,
  publish: (request: FundamentalsRequest) => Promise<unknown> = request => publishFundamentalsMessage(process.env.FUNDAMENTALS_REQUEST_TOPIC || 'sec-fundamentals-requests', request)) {
  const ref = db.collection('company_fundamentals').doc(`_batch_${batchId}`);
  const request = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.get('manualRequired') !== true) return null;
    const request = parseFundamentalsRequest(snapshot.get('request'));
    const progress = snapshot.get('progress') ?? {};
    if (request.reason === 'verification') {
      const refs = request.companyIds.map(id => db.collection('company_fundamentals').doc(usFundamentalsId(id)));
      const docs = await Promise.all(refs.map(ref => tx.get(ref)));
      const savedError = snapshot.get('lastError');
      for (let i = 0; i < docs.length; i++) {
        const company = docs[i], id = request.companyIds[i], value = company.get('value');
        if (company.get('outcome') === 'ready' && company.get('pending') !== true && value) continue;
        const error = company.get('lastError');
        const expected = `/company_fundamentals/_batch_${batchId}`;
        if (snapshot.get('completed') !== true || snapshot.get('result')?.status !== 'verified'
          || company.get('outcome') !== 'error' || company.get('pending') === true || !value || Number(savedError?.code) !== 6 || Number(error?.code ?? savedError.code) !== 6
          || !String(savedError?.message ?? '').endsWith(expected) || !String(error?.message ?? '').endsWith(expected)
          || progress[id]?.completed !== true || progress[id]?.failed === true || progress[id]?.version !== fundamentalsVersion(value)) {
          throw new Error('Verification requires healthy cached companies; review company failures first');
        }
        // Repair only the exact false error from this completed verification batch.
        tx.set(refs[i], {outcome:'ready',pending:false,lastError:FieldValue.delete(),failedAt:FieldValue.delete()}, {merge:true});
      }
      for (const id of request.companyIds) if (progress[id]?.failed) delete progress[id];
      tx.update(ref,{manualRequired:false,progress,manualRetryBy:uid,manualRetryAt:new Date().toISOString()});
      return request;
    }
    const retryIds = request.companyIds.filter(id => !progress[id]?.completed || progress[id]?.failed);
    const docs = await Promise.all(retryIds.map(id => tx.get(db.collection('company_fundamentals').doc(usFundamentalsId(id)))));
    for (let i=0;i<retryIds.length;i++) {
      if (['error','retry'].includes(docs[i].get('outcome'))) tx.set(docs[i].ref, {outcome:'pending',pending:true,refreshAfter:0}, {merge:true});
      if (progress[retryIds[i]]?.failed) delete progress[retryIds[i]];
    }
    tx.update(ref,{manualRequired:false,completed:false,progress,manualRetryBy:uid,manualRetryAt:new Date().toISOString()});
    return request;
  });
  if (!request) return false;
  try {await publish(request);} catch (error) {
    if(request.reason!=='verification') for(const ticker of request.companyIds) await db.runTransaction(async tx=>{const company=db.collection('company_fundamentals').doc(usFundamentalsId(ticker));const snapshot=await tx.get(company);if(snapshot.get('pending')===true)tx.set(company,{pending:false,outcome:'error',lastError:{message:'Could not publish manual rerun'}},{merge:true});});
    await ref.set({manualRequired:true,lastError:{message:'Could not publish manual rerun'},failedAt:new Date().toISOString()}, {merge:true});
    throw error;
  }
  return true;
}
