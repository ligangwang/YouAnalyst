import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldPath } from "firebase-admin/firestore";
import type { InstitutionalHoldingChange } from "@/lib/securities/thirteen-f";

export type FollowedInstitution = {
  cik: string;
  name: string;
  latestAccessionNumber: string | null;
  latestReportDate: string | null;
  latestQuarter: string | null;
  updatedAt: string | null;
  followedAt: string;
};

export type FollowedInstitutionActivity = {
  positionKey: string;
  managerCik: string;
  managerName: string;
  ticker: string | null;
  nameOfIssuer: string;
  quarter: string;
  reportDate: string;
  filingDate: string;
  accessionNumber: string;
  status: InstitutionalHoldingChange["status"];
  shareChange: number;
  valueChangeUsd: number;
  percentChange: number | null;
  updatedAt: string;
};

export type InstitutionDigestPreferences = {
  enabled: boolean;
  cadence: "daily" | "weekly";
  lastSentAt: string | null;
};

export type InstitutionDigestPreview = {
  preferences: InstitutionDigestPreferences;
  items: FollowedInstitutionActivity[];
  generatedAt: string;
  wouldSend: boolean;
};

export type InstitutionDigestRunInput = {
  dryRun?: boolean;
  limitUsers?: number;
  limitItems?: number;
  userIds?: string[];
};

export type InstitutionDigestRunUserResult = {
  userId: string;
  cadence: InstitutionDigestPreferences["cadence"];
  lastSentAt: string | null;
  itemCount: number;
  wouldSend: boolean;
  updatedCheckpoint: boolean;
  runId: string | null;
  error: string | null;
};

export type InstitutionDigestRunResult = {
  dryRun: boolean;
  generatedAt: string;
  scannedUsers: number;
  candidateUsers: number;
  sendableUsers: number;
  totalItems: number;
  users: InstitutionDigestRunUserResult[];
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

function followedActivityFromChange(change: InstitutionalHoldingChange): FollowedInstitutionActivity {
  return {
    positionKey: change.positionKey,
    managerCik: change.managerCik,
    managerName: change.managerName,
    ticker: change.ticker,
    nameOfIssuer: change.nameOfIssuer,
    quarter: change.quarter,
    reportDate: change.reportDate,
    filingDate: change.filingDate,
    accessionNumber: change.accessionNumber,
    status: change.status,
    shareChange: change.shareChange,
    valueChangeUsd: change.valueChangeUsd,
    percentChange: change.percentChange,
    updatedAt: change.updatedAt,
  };
}

function institutionDigestPreferencesFromUser(data: Record<string, unknown> | undefined): InstitutionDigestPreferences {
  const settings = data?.settings && typeof data.settings === "object"
    ? data.settings as Record<string, unknown>
    : {};

  return {
    enabled: settings.institutionDigestEnabled === true,
    cadence: settings.institutionDigestCadence === "daily" ? "daily" : "weekly",
    lastSentAt: typeof settings.institutionDigestLastSentAt === "string" ? settings.institutionDigestLastSentAt : null,
  };
}

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.trunc(value as number)));
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

export async function listFollowedInstitutionActivity(userId: string, limit = 24): Promise<FollowedInstitutionActivity[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 24;
  const followedInstitutions = await listFollowedInstitutions(userId, 12);
  const db = getAdminFirestore();
  const managerSnapshots = await Promise.all(
    followedInstitutions.map((institution) => db.collection("institutional_managers").doc(institution.cik).get()),
  );
  const activitySnapshots = await Promise.all(
    managerSnapshots.flatMap((snapshot) => {
      if (!snapshot.exists) {
        return [];
      }

      const manager = followedInstitutionFromManager(
        snapshot.id,
        snapshot.data() as InstitutionalManagerDocument,
        "",
      );
      if (!manager.latestQuarter) {
        return [];
      }

      const docPrefix = `${manager.latestQuarter}_${manager.cik}_`;

      return db
        .collection("institutional_holding_changes")
        .where(FieldPath.documentId(), ">=", docPrefix)
        .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
        .orderBy(FieldPath.documentId())
        .get();
    }),
  );
  const activities = activitySnapshots.flatMap((snapshot) => (
    snapshot.docs.map((doc) => followedActivityFromChange(doc.data() as InstitutionalHoldingChange))
  ));

  return activities
    .sort((left, right) => (
      right.reportDate.localeCompare(left.reportDate) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      Math.abs(right.valueChangeUsd) - Math.abs(left.valueChangeUsd)
    ))
    .slice(0, normalizedLimit);
}

export async function getInstitutionDigestPreferences(userId: string): Promise<InstitutionDigestPreferences | null> {
  const snapshot = await getAdminFirestore().collection("users").doc(userId).get();
  if (!snapshot.exists) {
    return null;
  }

  return institutionDigestPreferencesFromUser(snapshot.data() as Record<string, unknown> | undefined);
}

export async function listFollowedInstitutionDigestActivity(
  userId: string,
  input: { since?: string | null; limit?: number } = {},
): Promise<FollowedInstitutionActivity[]> {
  const preferences = await getInstitutionDigestPreferences(userId);
  if (!preferences?.enabled) {
    return [];
  }

  const since = input.since ?? preferences.lastSentAt;
  const activities = await listFollowedInstitutionActivity(userId, input.limit ?? 50);

  if (!since) {
    return activities;
  }

  return activities.filter((activity) => (
    activity.updatedAt > since ||
    activity.filingDate > since ||
    activity.reportDate > since
  ));
}

export async function previewFollowedInstitutionDigest(userId: string, limit = 20): Promise<InstitutionDigestPreview | null> {
  const preferences = await getInstitutionDigestPreferences(userId);
  if (!preferences) {
    return null;
  }

  const activities = await listFollowedInstitutionActivity(userId, limit);
  const items = preferences.lastSentAt
    ? activities.filter((activity) => (
        activity.updatedAt > preferences.lastSentAt! ||
        activity.filingDate > preferences.lastSentAt! ||
        activity.reportDate > preferences.lastSentAt!
      ))
    : activities;

  return {
    preferences,
    items,
    generatedAt: new Date().toISOString(),
    wouldSend: preferences.enabled && items.length > 0,
  };
}

export async function runInstitutionDigest(input: InstitutionDigestRunInput = {}): Promise<InstitutionDigestRunResult> {
  const dryRun = input.dryRun !== false;
  const generatedAt = new Date().toISOString();
  const limitUsers = normalizeLimit(input.limitUsers, 50, 500);
  const limitItems = normalizeLimit(input.limitItems, 50, 100);
  const db = getAdminFirestore();
  const userIds = [...new Set(input.userIds?.map((userId) => userId.trim()).filter(Boolean) ?? [])].slice(0, limitUsers);
  const userSnapshots = userIds.length > 0
    ? await Promise.all(userIds.map((userId) => db.collection("users").doc(userId).get()))
    : (await db
        .collection("users")
        .where("settings.institutionDigestEnabled", "==", true)
        .limit(limitUsers)
        .get()).docs;
  const users: InstitutionDigestRunUserResult[] = [];

  for (const snapshot of userSnapshots) {
    if (!snapshot.exists) {
      users.push({
        userId: snapshot.id,
        cadence: "weekly",
        lastSentAt: null,
        itemCount: 0,
        wouldSend: false,
        updatedCheckpoint: false,
        runId: null,
        error: "User profile not found",
      });
      continue;
    }

    const preferences = institutionDigestPreferencesFromUser(snapshot.data() as Record<string, unknown> | undefined);
    if (!preferences.enabled) {
      continue;
    }

    try {
      const items = await listFollowedInstitutionDigestActivity(snapshot.id, { limit: limitItems });
      const wouldSend = items.length > 0;
      let runId: string | null = null;

      if (wouldSend) {
        const runRef = db.collection("institution_digest_runs").doc();
        runId = runRef.id;
        const runRecord = {
          userId: snapshot.id,
          dryRun,
          cadence: preferences.cadence,
          lastSentAt: preferences.lastSentAt,
          generatedAt,
          itemCount: items.length,
          wouldSend,
          itemKeys: items.map((item) => item.positionKey),
          status: dryRun ? "DRY_RUN" : "CHECKPOINTED",
        };

        if (dryRun) {
          await runRef.set(runRecord);
        } else {
          await db.runTransaction(async (tx) => {
            tx.set(runRef, runRecord);
            tx.update(db.collection("users").doc(snapshot.id), {
              "settings.institutionDigestLastSentAt": generatedAt,
              updatedAt: generatedAt,
            });
          });
        }
      }

      users.push({
        userId: snapshot.id,
        cadence: preferences.cadence,
        lastSentAt: preferences.lastSentAt,
        itemCount: items.length,
        wouldSend,
        updatedCheckpoint: !dryRun && wouldSend,
        runId,
        error: null,
      });
    } catch (error) {
      users.push({
        userId: snapshot.id,
        cadence: preferences.cadence,
        lastSentAt: preferences.lastSentAt,
        itemCount: 0,
        wouldSend: false,
        updatedCheckpoint: false,
        runId: null,
        error: error instanceof Error ? error.message : "Failed to compute institution digest",
      });
    }
  }

  return {
    dryRun,
    generatedAt,
    scannedUsers: userSnapshots.length,
    candidateUsers: users.length,
    sendableUsers: users.filter((user) => user.wouldSend).length,
    totalItems: users.reduce((total, user) => total + user.itemCount, 0),
    users,
  };
}
