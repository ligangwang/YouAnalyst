import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

// Authentication must not import the research caches or initialize a data store.
export function memberAuth() {
  const app = getApps().find(app => app.name === 'member-access') ?? initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  }, 'member-access');
  return getAuth(app);
}
export function isRegisteredMember(claims: DecodedIdToken): boolean {
  return !!claims.uid && !!claims.firebase?.sign_in_provider && claims.firebase.sign_in_provider !== 'anonymous';
}
export async function verifyMember(token: string): Promise<DecodedIdToken | null> {
  if (!token || token.length > 16000) return null;
  try {
    const claims = await memberAuth().verifyIdToken(token);
    return isRegisteredMember(claims) ? claims : null;
  } catch { return null; }
}
