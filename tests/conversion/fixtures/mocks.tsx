import { useSyncExternalStore, type ComponentProps } from "react";

export type AuthScenario = {
  signedIn?: boolean;
  googleNew?: boolean;
  authFails?: boolean;
  googleErrorCode?: string;
};

declare global {
  interface Window {
    authScenario?: AuthScenario;
  }
}

const mockUser = (uid: string) => ({ uid, providerData: [], photoURL: null, getIdToken: async () => "isolated-test-token" });
let user = window.authScenario?.signedIn ? mockUser("test-user") : null;
window.addEventListener("test-auth-user", (event) => {
  const uid = (event as CustomEvent<string | null>).detail;
  user = uid ? mockUser(uid) : null;
  window.dispatchEvent(new Event("auth-change"));
});
const subscribe = (callback: () => void) => {
  window.addEventListener("auth-change", callback);
  return () => window.removeEventListener("auth-change", callback);
};
const getIdToken = async () => "isolated-test-token";
async function authenticate(shouldCompleteProfile: boolean) {
  if (window.authScenario?.authFails) throw new Error("Test authentication failed");
  user = mockUser("test-user");
  window.dispatchEvent(new Event("auth-change"));
  return { user, shouldCompleteProfile };
}
export function useAuth() {
  const currentUser = useSyncExternalStore(subscribe, () => user);
  return {
    user: currentUser,
    profilePhotoURL: currentUser?.photoURL ?? null,
    setProfilePhotoURL: () => {},
    loading: false,
    error: null,
    features: { proFeaturesEnabled: false, canUsePro: false },
    getIdToken,
    signInWithGoogle: async () => {
      if (window.authScenario?.googleErrorCode) throw Object.assign(new Error("Popup dismissed"), { code: window.authScenario.googleErrorCode });
      return authenticate(window.authScenario?.googleNew ?? true);
    },
    signInWithEmail: () => authenticate(false),
    createAccountWithEmail: () => authenticate(true),
  };
}

export const useOptionalAuth = useAuth;

const router = {
  refresh() {},
  push(href: string) {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("route-change"));
  },
};
export function useRouter() { return router; }
export default function Link(props: ComponentProps<"a">) { return <a {...props} />; }
