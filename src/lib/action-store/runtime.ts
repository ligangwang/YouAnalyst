import {ActionStore,type ActionRepository} from './storage';
import {actionBucketName} from './config';
// Tests inject a repository for their DB instance.
declare global {var __youAnalystActionTestPorts:WeakMap<object,ActionRepository>|undefined;}
const overrides=globalThis.__youAnalystActionTestPorts??=new WeakMap<object,ActionRepository>();
export function setActionRepositoryForTest(db:object,repository:ActionRepository){overrides.set(db,repository);}
let store:Promise<ActionStore>|undefined;
export async function actionRepository(db:object):Promise<ActionRepository>{
 const override=overrides.get(db);if(override)return override;
 const current=await (store??=import('../firebase/admin').then(({getAdminStorageBucket})=>{
  return new ActionStore(getAdminStorageBucket(actionBucketName()));
 }).catch(e=>{store=undefined;throw e;}));
 return current;
}
