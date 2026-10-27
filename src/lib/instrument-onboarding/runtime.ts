import type {Firestore} from 'firebase-admin/firestore';
import {getAdminStorageBucket} from '../firebase/admin';
import {createMaintenanceLog} from '../maintenance-log';
import {createOnboardingHandlers} from './handlers';
import {loadBusinessEvidence} from '../company-themes/business-evidence';
import {classifyOfficialThemes} from '../company-themes/classification';
import {loadOfficialAnnual} from '../company-themes/official-annual-loader';
import {officialAnnualTransport} from '../company-themes/official-annual-transport';
import {getOpenAiApiKey} from '../openai-runtime';
import {safeRecordOpenAiUsageEvent} from '../openai/usage';
import type {EnrollmentBatch} from '../company-themes/enrollment';

export function onboardingRuntime(db:Firestore,themeBatches:EnrollmentBatch[]=[]){
  const bucketName=process.env.EODHD_BULK_EOD_BUCKET,token=process.env.EODHD_API_TOKEN;
  if(!bucketName||!token)throw Error('Existing EODHD bucket and token are required');
  const log=createMaintenanceLog('instrument-onboarding');
  const handlers=createOnboardingHandlers({db,bucket:getAdminStorageBucket(bucketName),token,log,themeBatches,
    classify:async(company,catalog)=>{
      const evidence=await loadBusinessEvidence(db,company);
      // Deployments explicitly opt in; other runtimes keep the search fallback.
      const verifiedAnnual=process.env.THEME_EVIDENCE_FIRST_ENABLED==='1' ? await loadOfficialAnnual(company,officialAnnualTransport(db),Date.now(),decision=>log.emit('INFO','theme_evidence_decision',{companyId:company.id,decision})) : null;
      return classifyOfficialThemes(company,catalog,{key:getOpenAiApiKey(),evidence,verifiedAnnual:verifiedAnnual??undefined,recordUsage:value=>safeRecordOpenAiUsageEvent({...value,purpose:'company_theme_classification',metadata:{companyId:company.id}})});
    },
    maintenanceReady:async()=>process.env.INSTRUMENT_ONBOARDING_MAINTENANCE_READY==='1'});
  return {handlers,log};
}
