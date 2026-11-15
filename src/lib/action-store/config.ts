export function actionBucketName(env:Record<string,string|undefined>=process.env){
 const bucket=env.ENTITY_SNAPSHOT_BUCKET||env.EODHD_BULK_EOD_BUCKET;
 if(!bucket)throw Error('Corporate action bucket is not configured');
 return bucket;
}
