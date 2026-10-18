import { getFirestore as sdkGetFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import { observeFirestore } from './firestore-observability';
export * from 'firebase-admin/firestore';
/** Shared entry point for CLI jobs and Pub/Sub services. */
export const getFirestore: typeof sdkGetFirestore = (...args: [] | [App] | [string] | [App, string]) =>
  observeFirestore(Reflect.apply(sdkGetFirestore, undefined, args));
