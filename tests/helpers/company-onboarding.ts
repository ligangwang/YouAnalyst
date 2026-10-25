import {Timestamp} from 'firebase-admin/firestore';
import type {CompanyOnboarding} from '../../src/lib/company-support/model';

export function onboarding(status: CompanyOnboarding['status'] = 'SUPPORTED'): CompanyOnboarding {
  const at=Timestamp.fromDate(new Date('2026-10-25T00:00:00Z'));
  return {status,version:1,requestedAt:null,startedAt:null,supportedAt:status==='SUPPORTED'?at:null,updatedAt:at,blockedReason:null};
}
