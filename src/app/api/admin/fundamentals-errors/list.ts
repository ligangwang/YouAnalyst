import type { Firestore } from 'firebase-admin/firestore';
import { withLiveCompanyReads } from '@/lib/local-cache/company-directory';

/** Admin decisions must see current failures, including newly written ledgers. */
export async function listFundamentalsErrors(db: Firestore) {
  return withLiveCompanyReads(async () => {
    const [rows,batches]=await Promise.all([
      db.collection('company_fundamentals').where('outcome','in',['error','retry']).limit(100).get(),
      db.collection('company_fundamentals').where('manualRequired','==',true).limit(100).get(),
    ]);
    const companyBatches=new Map<string,string>();
    for(const batch of batches.docs)for(const ticker of batch.get('request')?.companyIds??[])companyBatches.set(ticker,batch.id.replace(/^_batch_/,''));
    const batchErrors=batches.docs.map(d=>({id:d.id,batchId:d.id.replace(/^_batch_/,''),ticker:(d.get('request')?.companyIds??[]).join(', '),message:d.get('lastError')?.message??'Batch failed',failedAt:d.get('failedAt')??null}));
    return {errors:[...batchErrors,...rows.docs.filter(d=>d.id.startsWith('US:')).map(d=>({id:d.id,batchId:companyBatches.get(d.id.slice(3)),ticker:d.id.slice(3),message:d.get('lastError')?.message??'Refresh failed',failedAt:d.get('failedAt')??d.get('lastAttemptAt')??null}))],limit:200};
  });
}
