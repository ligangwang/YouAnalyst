import { observeFirestore } from './firestore-observability';
import * as admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";

declare global {
  var __adminApp: admin.app.App | undefined;
}

function getAdminApp(): admin.app.App {
  if (globalThis.__adminApp) return globalThis.__adminApp;

  if (admin.apps.length > 0) {
    globalThis.__adminApp = admin.app();
    return globalThis.__adminApp;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) as admin.ServiceAccount;
    globalThis.__adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
  } else {
    // Cloud Run and other GCP environments supply ADC automatically
    globalThis.__adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }

  return globalThis.__adminApp;
}

export async function verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getAdminApp().auth().verifyIdToken(token);
}

export function getAdminFirestore(): admin.firestore.Firestore {
  return observeFirestore(getAdminApp().firestore());
}

export function getAdminStorageBucket(bucketName?: string) {
  const resolvedBucketName = bucketName?.trim() || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (!resolvedBucketName) {
    throw new Error("A Firebase/Google Cloud Storage bucket is not configured.");
  }

  return getStorage(getAdminApp()).bucket(resolvedBucketName);
}
