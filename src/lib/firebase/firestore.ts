import { getFirestore as sdkGetFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import {enableCompanyDirectory} from '../local-cache/company-directory';
import { observeFirestore } from './firestore-observability';
export * from 'firebase-admin/firestore';
/** Shared entry point for CLI jobs and Pub/Sub services. */
export const getFirestore: typeof sdkGetFirestore = (...args: [] | [App] | [string] | [App, string]) => {
  const db=observeFirestore(Reflect.apply(sdkGetFirestore, undefined, args));
  // Worker company reads share memory, snapshot files and watermark catch-up.
  // Transactions and explicit live reads still bypass the directory.
  enableCompanyDirectory(db,db,{onlyCollections:['companies']});
  return db;
};
