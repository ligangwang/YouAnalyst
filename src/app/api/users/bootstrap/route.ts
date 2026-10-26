import { resolveProfilePhoto } from "@/lib/users/photo";
import { getAdminAuth, getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { canUseProFeaturesForUserData, getAppFeatures } from "@/lib/features";
import { getOrCreateDefaultWatchlistForUser } from "@/lib/watchlists/service";
import { NextRequest, NextResponse } from "next/server";

type BootstrapRequest = {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};

function resolveProvider(signInProvider?: string): "google" | "email" {
  return signInProvider === "google.com" ? "google" : "email";
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await verifyIdToken(token);
    const payload = (await request.json().catch(() => ({}))) as BootstrapRequest;
    const features = getAppFeatures();
    const db = getAdminFirestore();
    const userRef = db.collection("users").doc(decoded.uid);
    const account = await getAdminAuth().getUser(decoded.uid);
    const google = account.providerData.find((provider) => provider.providerId === "google.com");
    const googlePhotoURL = google?.photoURL ?? null;

    const userProfile = {
      displayName: payload.displayName ?? decoded.name ?? null,
      email: payload.email ?? decoded.email ?? null,
      photoURL: googlePhotoURL ?? account.photoURL ?? null,
      photoSource: "google",
      authProviders: [resolveProvider(decoded.firebase.sign_in_provider)],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bio: "",
      nickname: null,
      role: "user",
      stats: {
        totalPredictions: 0,
        totalCalls: 0,
        openingPredictions: 0,
        openPredictions: 0,
        closingPredictions: 0,
        closedPredictions: 0,
        canceledPredictions: 0,
        totalScore: 0,
        settledCalls: 0,
        totalXP: 0,
        level: 1,
        avgPredictionScore: 0,
        consistency: 0,
        coverage: 0,
        avgReturn: 0,
        winRate: 0,
        eligibleForLeaderboard: false,
        followersCount: 0,
        followingCount: 0,
      },
      settings: {
        isPublic: true,
      },
      billing: {
        plan: "FREE",
      },
    };

    // Auth restoration and explicit signup may bootstrap concurrently. Never
    // overwrite a profile or its watchlist counters created by the other request.
    const result = await db.runTransaction(async tx => {
      const current = await tx.get(userRef);
      if (current.exists) {
        const data = current.data() as Record<string, unknown>;
        const photoURL = google || data.photoSource === "google"
          ? resolveProfilePhoto(data, googlePhotoURL)
          : typeof data.photoURL === "string" ? data.photoURL : null;
        if (photoURL !== (data.photoURL ?? null)) tx.update(userRef, { photoURL, updatedAt: new Date().toISOString() });
        return { created: false, photoURL, data };
      }
      tx.set(userRef, userProfile);
      return { created: true, photoURL: userProfile.photoURL, data: userProfile };
    });
    await getOrCreateDefaultWatchlistForUser(decoded.uid);

    return NextResponse.json({
      created: result.created,
      photoURL: result.photoURL,
      features: {
        ...features,
        canUsePro: canUseProFeaturesForUserData(result.data),
      },
    });
  } catch (error) {
    console.error("Failed to bootstrap user profile:", error);
    return NextResponse.json({ error: "Failed to bootstrap user profile" }, { status: 500 });
  }
}
