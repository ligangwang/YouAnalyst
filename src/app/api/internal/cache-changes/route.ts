import { OAuth2Client } from 'google-auth-library';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { applyCacheChange } from '@/lib/change-cache';

export const runtime = 'nodejs';
const verifier = new OAuth2Client();

export async function POST(request: Request) {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const audience = process.env.CACHE_EVENT_AUDIENCE;
  if (!project || !audience) return new Response('Change receiver not configured', { status: 503 });
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 });
  try {
    const payload = (await verifier.verifyIdToken({ idToken: authorization.slice(7), audience })).getPayload();
    if (payload?.email !== `cache-events@${project}.iam.gserviceaccount.com` || payload.email_verified !== true)
      return new Response('Forbidden', { status: 403 });
  } catch { return new Response('Unauthorized', { status: 401 }); }
  try {
    await applyCacheChange(getAdminFirestore(), request.headers, project, new Uint8Array(await request.arrayBuffer()));
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Cache change delivery failed', error);
    // Eventarc retries failures. Never acknowledge a failed invalidation.
    return new Response('Change delivery failed', { status: 503 });
  }
}
