import { FirebaseError } from "firebase/app";

type MockUser = { uid: string; getIdToken: () => Promise<string>; displayName: string; email: string; photoURL: null };
declare global {
  interface Window {
    authMeasurementScenario?: { errorCode?: string; googleNew?: boolean };
    authMeasurementAttempts?: string[];
  }
}

let user: MockUser | null = null;
const observers = new Set<(user: MockUser | null) => void>();
export const browserLocalPersistence = {};
export const browserPopupRedirectResolver = {};
export const isFirebaseConfigured = () => true;
export const getFirebaseServices = () => ({ auth: {}, googleProvider: {} });
export const setPersistence = async () => {};
export function onAuthStateChanged(_auth: unknown, callback: (user: MockUser | null) => void) {
  observers.add(callback);
  queueMicrotask(() => { if (observers.has(callback)) callback(user); });
  return () => observers.delete(callback);
}
async function authenticate(method: string, isNewUser: boolean) {
  (window.authMeasurementAttempts ??= []).push(method);
  const code = window.authMeasurementScenario?.errorCode;
  if (code) throw new FirebaseError(code, "Private test detail: private@example.invalid");
  user = { uid: "measurement-user", getIdToken: async () => "measurement-token", displayName: "Private Name", email: "private@example.invalid", photoURL: null };
  observers.forEach(callback => callback(user));
  return { user, isNewUser };
}
export const signInWithPopup = () => authenticate("google", window.authMeasurementScenario?.googleNew ?? true);
export const createUserWithEmailAndPassword = () => authenticate("email_signup", true);
export const signInWithEmailAndPassword = () => authenticate("email_login", false);
export const getAdditionalUserInfo = (credential: { isNewUser: boolean }) => ({ isNewUser: credential.isNewUser });
export const signOut = async () => { user = null; observers.forEach(callback => callback(user)); };

export const useRouter = () => ({
  push(href: string) {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("route-change"));
  },
});
