import {ActionStore,type ActionRepository} from './storage';
// Tests inject a repository for their DB instance; production has no Firestore fallback.
declare global {var __youAnalystActionTestPorts:WeakMap<object,ActionRepository>|undefined;}
const overrides=globalThis.__youAnalystActionTestPorts??=new WeakMap<object,ActionRepository>();
export function setActionRepositoryForTest(db:object,repository:ActionRepository){overrides.set(db,repository);}
let store:Promise<ActionStore>|undefined;
export async function actionRepository(db:object):Promise<ActionRepository>{
 const override=overrides.get(db);if(override)return override;
 return store??=import('../firebase/admin').then(({getAdminStorageBucket})=>{
  const bucket=process.env.ENTITY_SNAPSHOT_BUCKET||process.env.EODHD_BULK_EOD_BUCKET;
  if(!bucket)throw Error('Corporate action bucket is not configured');
  return new ActionStore(getAdminStorageBucket(bucket));
 }).catch(e=>{store=undefined;throw e;});
}
