import { NextRequest } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { communityResponse } from '@/lib/relationship-review/community-http';

export const runtime = 'nodejs';
async function handle(request: NextRequest) {
  return communityResponse(request, { db: getAdminFirestore, authenticate: async () => {
    const user = await getDecodedUserFromRequest(request);
    return user ? { uid: user.uid, admin: false } : null;
  } });
}
export const GET = handle;
export const POST = handle;
