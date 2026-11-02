import type {Firestore} from 'firebase-admin/firestore';
import {readCollectionCompanies} from '../company-support/collection-reader';

/** Earnings and SEC scheduling share memory, snapshot and watermark catch-up. */
export function readEarningsScheduleCompanies(db:Firestore){
  return readCollectionCompanies(db,[],'CN');
}
