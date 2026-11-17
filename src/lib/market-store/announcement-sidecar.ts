import {createHash} from 'node:crypto';
import {quote} from '../price-store/parquet';
import {ANNOUNCEMENT_LOOKUP} from './announcement-index';

export const announcementBucket=(company:string)=>parseInt(createHash('sha256').update(company).digest('hex')[0],16);
export function announcementIndexFile(prefixFile:string,bucket:number){
    if(!Number.isInteger(bucket)||bucket<0||bucket>15)throw Error('Invalid announcement bucket');
    return prefixFile.replace(/\.parquet$/,`-a${bucket.toString(16)}.parquet`);
}
/** The bucket exists only in a temporary DuckDB table. Published objects retain
 * the existing field/payload schema. Empty markers prove shard completeness
 * without duplicating the legacy all-company ID lists into every bucket. */
export function announcementIndexRows(path:string,bundled:boolean){
    const company=ANNOUNCEMENT_LOOKUP+'/company/',records=ANNOUNCEMENT_LOOKUP+'/records/';
    const marker=`(field=${quote(ANNOUNCEMENT_LOOKUP)} OR starts_with(field,${quote(ANNOUNCEMENT_LOOKUP+':')}))`;
    const key=`CASE WHEN starts_with(field,${quote(company)}) THEN substr(field,${company.length+1}) WHEN starts_with(field,${quote(records)}) THEN substr(field,${records.length+1}) END`;
    const identity=bundled?`left((${key}),length((${key}))-3)`:key;
    return `SELECT field,CASE WHEN ${marker} THEN '[]' ELSE payload END AS payload,CASE WHEN ${marker} THEN NULL ELSE strpos('0123456789abcdef',substr(sha256(${identity}),1,1))-1 END AS bucket FROM read_parquet(${quote(path)}) WHERE ${marker} OR starts_with(field,${quote(company)}) OR starts_with(field,${quote(records)})`;
}
