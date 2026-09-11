"use client";

import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FirebaseError } from "firebase/app";
import { getFirebaseServices, isFirebaseConfigured } from "@/lib/firebase/client";
import type { AppFeatures } from "@/lib/features";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  features: AppFeatures;
  signInWithGoogle: () => Promise<AuthActionResult>;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  createAccountWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthActionResult = {
  user: User;
  shouldCompleteProfile: boolean;
};

type AuthProviderProps = {
  children: ReactNode;
};

const DEFAULT_FEATURES: AppFeatures = {
  proFeaturesEnabled: false,
  billingEnabled: false,
  proBillingBypass: false,
  canUsePro: false,
};

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "This email already has an account. Sign in instead.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "Email or password is incorrect.";
      case "auth/weak-password":
        return "Use a stronger password with at least 6 characters.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a moment and try again.";
      case "auth/popup-closed-by-user":
        return "Google sign-in was canceled. Try again when you're ready.";
      case "auth/account-exists-with-different-credential":
        return "This email already uses a different sign-in method.";
      case "auth/network-request-failed":
        return "Network problem. Check your connection and try again.";
      case "auth/operation-not-allowed":
        return "This sign-in method is not enabled yet.";
      default:
        return fallback;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function isDismissedPopupError(error: unknown): boolean {
  return error instanceof FirebaseError &&
    (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request");
}

function friendlyError(error: unknown, fallback: string): Error {
  return new Error(toMessage(error, fallback));
}

export function AuthProvider({ children }: AuthProviderProps) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => configured);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<AppFeatures>(DEFAULT_FEATURES);

  const bootstrapUserProfile = useCallback(async (nextUser: User) => {
    const token = await nextUser.getIdToken();
    const response = await fetch("/api/users/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        displayName: nextUser.displayName,
        email: nextUser.email,
        photoURL: nextUser.photoURL,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to create user profile.");
    }

    return (await response.json()) as { created: boolean; features?: AppFeatures };
  }, []);

  useEffect(() => {
    if (!configured) {
      return;
    }

    const { auth } = getFirebaseServices();
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);

      if (!nextUser) {
        setFeatures(DEFAULT_FEATURES);
        return;
      }

      void bootstrapUserProfile(nextUser)
        .then((payload) => {
          setFeatures(payload.features ?? DEFAULT_FEATURES);
        })
        .catch((nextError) => {
          setError(toMessage(nextError, "Unable to create user profile."));
        });
    });

    void setPersistence(auth, browserLocalPersistence).catch((nextError) => {
      setError(toMessage(nextError, "Unable to persist authentication state."));
    });

    return unsubscribe;
  }, [bootstrapUserProfile, configured]);

  const signInWithGoogle = useCallback(async () => {
    if (!configured) {
      const nextError = new Error("Firebase is not configured.");
      setError(nextError.message);
      throw nextError;
    }

    setError(null);
    try {
      const { auth, googleProvider } = getFirebaseServices();
      const credential = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      const additionalUserInfo = getAdditionalUserInfo(credential);
      const payload = await bootstrapUserProfile(credential.user);
      setFeatures(payload.features ?? DEFAULT_FEATURES);

      return {
        user: credential.user,
        shouldCompleteProfile: additionalUserInfo?.isNewUser ?? false,
      };
    } catch (nextError) {
      if (isDismissedPopupError(nextError)) {
        setError(null);
        throw nextError;
      }

      const friendly = friendlyError(nextError, "Google sign-in failed.");
      setError(friendly.message);
      throw friendly;
    }
  }, [bootstrapUserProfile, configured]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (!configured) {
        const nextError = new Error("Firebase is not configured.");
        setError(nextError.message);
        throw nextError;
      }

      setError(null);
      try {
        const { auth } = getFirebaseServices();
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const payload = await bootstrapUserProfile(credential.user);
        setFeatures(payload.features ?? DEFAULT_FEATURES);

        return {
          user: credential.user,
          shouldCompleteProfile: false,
        };
      } catch (nextError) {
        const friendly = friendlyError(nextError, "Email sign-in failed.");
        setError(friendly.message);
        throw friendly;
      }
    },
    [bootstrapUserProfile, configured],
  );

  const createAccountWithEmail = useCallback(
    async (email: string, password: string) => {
      if (!configured) {
        const nextError = new Error("Firebase is not configured.");
        setError(nextError.message);
        throw nextError;
      }

      setError(null);
      try {
        const { auth } = getFirebaseServices();
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const payload = await bootstrapUserProfile(credential.user);
        setFeatures(payload.features ?? DEFAULT_FEATURES);

        return {
          user: credential.user,
          shouldCompleteProfile: true,
        };
      } catch (nextError) {
        const friendly = friendlyError(nextError, "Email account creation failed.");
        setError(friendly.message);
        throw friendly;
      }
    },
    [bootstrapUserProfile, configured],
  );

  const signOut = useCallback(async () => {
    if (!configured) {
      setUser(null);
      return;
    }

    setError(null);
    try {
      const { auth } = getFirebaseServices();
      await firebaseSignOut(auth);
      setUser(null);
      setFeatures(DEFAULT_FEATURES);
    } catch (nextError) {
      const friendly = friendlyError(nextError, "Sign-out failed.");
      setError(friendly.message);
      throw friendly;
    }
  }, [configured]);

  const getIdToken = useCallback(async (forceRefresh = false) => {
    if (!user) {
      return null;
    }
    return user.getIdToken(forceRefresh);
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured,
      error,
      features,
      signInWithGoogle,
      signInWithEmail,
      createAccountWithEmail,
      signOut,
      getIdToken,
    }),
    [
      user,
      loading,
      configured,
      error,
      features,
      signInWithGoogle,
      signInWithEmail,
      createAccountWithEmail,
      signOut,
      getIdToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
