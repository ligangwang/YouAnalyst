import type {Bucket} from '@google-cloud/storage';
import {COMPANY_VIEW_OBJECT,companyViewData} from './company-view';
import {sqliteSnapshotFiles} from './sqlite-storage';

/** Publish the derived view after the full snapshot succeeds. Each file carries
 * its own watermark; readers replay changes from that boundary independently. */
export function companyViewSnapshotFiles(bucket:Bucket){
 const full=sqliteSnapshotFiles(bucket),view=sqliteSnapshotFiles(bucket,()=>COMPANY_VIEW_OBJECT);
 return {
  load:full.load,
  async save(...args:Parameters<typeof full.save>){
   const [collection,snapshot]=args;
   // Project before full.save releases the previous SQLite reader.
   const projected=collection==='companies'?{...snapshot,rows:snapshot.rows.map(row=>({id:row.id,data:companyViewData(row.data)}))}:undefined;
   await full.save(...args);
   if(!projected)return;
   const previous=await view.load('companies');
   const watermark=previous.snapshot?.watermark;
   if(watermark&&(watermark.seconds>projected.watermark.seconds||watermark.seconds===projected.watermark.seconds&&watermark.nanoseconds>=projected.watermark.nanoseconds))return;
   // A competing publisher cannot overwrite a newer generation. Failure leaves
   // the previous view valid; the next run retries from the full file boundary.
   await view.save('companies',projected,previous.generation);
  },
  async close(){await Promise.all([full.close(),view.close()]);},
 };
}
