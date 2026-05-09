import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { canUseProFeaturesForUserData, getAppFeatures } from "@/lib/features";
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
    const userSnapshot = await userRef.get();

    if (userSnapshot.exists) {
      const userData = userSnapshot.data() as Record<string, unknown> | undefined;
      return NextResponse.json({
        created: false,
        features: {
          ...features,
          canUsePro: canUseProFeaturesForUserData(userData),
        },
      });
    }

    const userProfile = {
      displayName: payload.displayName ?? decoded.name ?? null,
      email: payload.email ?? decoded.email ?? null,
      photoURL: payload.photoURL ?? decoded.picture ?? null,
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
        institutionDigestEnabled: false,
        institutionDigestCadence: "weekly",
        institutionDigestLastSentAt: null,
      },
      billing: {
        plan: "FREE",
      },
    };

    await userRef.set(userProfile);

    return NextResponse.json({
      created: true,
      features: {
        ...features,
        canUsePro: canUseProFeaturesForUserData(userProfile as Record<string, unknown>),
      },
    });
  } catch (error) {
    console.error("Failed to bootstrap user profile:", error);
    return NextResponse.json({ error: "Failed to bootstrap user profile" }, { status: 500 });
  }
}
