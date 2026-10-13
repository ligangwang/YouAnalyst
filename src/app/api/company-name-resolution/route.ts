import { NextRequest } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { nameResolutionResponse } from '@/lib/market-companies/name-resolution-http';
export const runtime='nodejs';
async function handle(request:NextRequest){return nameResolutionResponse(request,{db:getAdminFirestore,authenticate:async()=>{const user=await getDecodedUserFromRequest(request);return user?{uid:user.uid,admin:await isAdminUser(user)}:null;}});}
export const GET=handle;
export const POST=handle;
