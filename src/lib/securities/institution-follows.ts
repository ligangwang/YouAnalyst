import { getAdminFirestore } from "@/lib/firebase/admin";

export type FollowedInstitution = {
  cik: string;
  name: string;
  latestAccessionNumber: string | null;
  latestReportDate: string | null;
  latestQuarter: string | null;
  updatedAt: string | null;
  followedAt: string;
};

type InstitutionalManagerDocument = {
  cik?: unknown;
  name?: unknown;
  latestAccessionNumber?: unknown;
  latestReportDate?: unknown;
  latestQuarter?: unknown;
  updatedAt?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeManagerCik(value: string): string | null {
  const digits = value.trim().replace(/\D/g, "");
  if (!digits || digits.length > 10) {
    return null;
  }

  return digits.padStart(10, "0");
}

function followedInstitutionFromManager(
  id: string,
  data: InstitutionalManagerDocument,
  followedAt: string,
): FollowedInstitution {
  const cik = readString(data.cik) ?? id;

  return {
    cik,
    name: readString(data.name) ?? cik,
    latestAccessionNumber: readString(data.latestAccessionNumber),
    latestReportDate: readString(data.latestReportDate),
    latestQuarter: readString(data.latestQuarter),
    updatedAt: readString(data.updatedAt),
    followedAt,
  };
}

function followedInstitutionFromData(id: string, data: Record<string, unknown> | undefined): FollowedInstitution {
  return {
    cik: readString(data?.cik) ?? id,
    name: readString(data?.name) ?? id,
    latestAccessionNumber: readString(data?.latestAccessionNumber),
    latestReportDate: readString(data?.latestReportDate),
    latestQuarter: readString(data?.latestQuarter),
    updatedAt: readString(data?.updatedAt),
    followedAt: readString(data?.followedAt) ?? "",
  };
}

export async function getInstitutionFollowState(rawCik: string, userId: string): Promise<{ cik: string; isFollowing: boolean } | null> {
  const cik = normalizeManagerCik(rawCik);
  if (!cik) {
    return null;
  }

  const db = getAdminFirestore();
  const snapshot = await db.collection("users").doc(userId).collection("followedInstitutions").doc(cik).get();
  return {
    cik,
    isFollowing: snapshot.exists,
  };
}

export async function followInstitution(rawCik: string, userId: string): Promise<FollowedInstitution | null> {
  const cik = normalizeManagerCik(rawCik);
  if (!cik) {
    return null;
  }

  const db = getAdminFirestore();
  const userRef = db.collection("users").doc(userId);
  const managerRef = db.collection("institutional_managers").doc(cik);
  const followedRef = userRef.collection("followedInstitutions").doc(cik);
  const followerRef = db.collection("institution_followers").doc(cik).collection("users").doc(userId);
  const nowIso = new Date().toISOString();

  const result = await db.runTransaction(async (tx) => {
    const [userSnapshot, managerSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(managerRef),
    ]);

    if (!userSnapshot.exists) {
      return { status: "user-not-found" as const };
    }

    if (!managerSnapshot.exists) {
      return { status: "manager-not-found" as const };
    }

    const manager = followedInstitutionFromManager(
      managerSnapshot.id,
      managerSnapshot.data() as InstitutionalManagerDocument,
      nowIso,
    );

    tx.set(followedRef, manager, { merge: true });
    tx.set(followerRef, { userId, followedAt: nowIso }, { merge: true });

    return { status: "followed" as const, manager };
  });

  if (result.status !== "followed") {
    return null;
  }

  return result.manager;
}

export async function unfollowInstitution(rawCik: string, userId: string): Promise<{ cik: string } | null> {
  const cik = normalizeManagerCik(rawCik);
  if (!cik) {
    return null;
  }

  const db = getAdminFirestore();
  const userRef = db.collection("users").doc(userId);
  const followedRef = userRef.collection("followedInstitutions").doc(cik);
  const followerRef = db.collection("institution_followers").doc(cik).collection("users").doc(userId);

  await db.runTransaction(async (tx) => {
    tx.delete(followedRef);
    tx.delete(followerRef);
  });

  return { cik };
}

export async function listFollowedInstitutions(userId: string, limit = 24): Promise<FollowedInstitution[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 24;
  const snapshot = await getAdminFirestore()
    .collection("users")
    .doc(userId)
    .collection("followedInstitutions")
    .orderBy("followedAt", "desc")
    .limit(normalizedLimit)
    .get();

  return snapshot.docs.map((doc) => followedInstitutionFromData(doc.id, doc.data()));
}
