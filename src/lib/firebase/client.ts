import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  );
}

function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

let clientAuth: Auth | undefined;

export function getFirebaseServices() {
  const app = getFirebaseApp();
  if (!clientAuth) {
    // Avoid eagerly loading Google's popup iframe for email-only sessions.
    clientAuth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
    if (typeof window !== "undefined") {
      // Configure synchronously, before persisted-user restoration starts.
      clientAuth.config.apiHost = `${window.location.host}/api/firebase-auth/identity`;
      clientAuth.config.tokenApiHost = `${window.location.host}/api/firebase-auth/token`;
      clientAuth.config.apiScheme = window.location.protocol.slice(0, -1);
    }
  }
  return {
    auth: clientAuth,
    db: getFirestore(app),
    googleProvider: new GoogleAuthProvider(),
  };
}
