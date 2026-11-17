import { getFirestore as sdkGetFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import {enableCompanyDirectory} from '../local-cache/company-directory';
import { observeFirestore } from './firestore-observability';
import {enableMarketStore,marketStoreClientReady} from '../market-store/runtime';
export * from 'firebase-admin/firestore';
/** Shared entry point for CLI jobs and Pub/Sub services. */
export const getFirestore: typeof sdkGetFirestore = (...args: [] | [App] | [string] | [App, string]) => {
  const market=enableMarketStore(Reflect.apply(sdkGetFirestore, undefined, args)),db=observeFirestore(market);
  // Worker company reads share memory, snapshot files and watermark catch-up.
  // Transactions and explicit live reads still bypass the directory.
  enableCompanyDirectory(db,db,{onlyCollections:['companies'],marketReady:collection=>marketStoreClientReady(market,collection)});
  return db;
};
