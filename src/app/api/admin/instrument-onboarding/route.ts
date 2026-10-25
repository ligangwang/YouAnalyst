import {NextRequest} from 'next/server';
import {adminOnboardingResponse} from '@/lib/instrument-onboarding/admin-http';
export const GET=(request:NextRequest)=>adminOnboardingResponse(request);
export const POST=(request:NextRequest)=>adminOnboardingResponse(request);
