import {companyThemesResponse} from '@/lib/company-themes/admin-http';
import type {NextRequest} from 'next/server';
export const GET=(request:NextRequest)=>companyThemesResponse(request);
export const POST=(request:NextRequest)=>companyThemesResponse(request);
