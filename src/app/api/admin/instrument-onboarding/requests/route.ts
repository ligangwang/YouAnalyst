import {NextRequest} from 'next/server';
import {adminBatchOnboardingResponse} from '@/lib/instrument-onboarding/batch-http';
export const POST=(request:NextRequest)=>adminBatchOnboardingResponse(request);
