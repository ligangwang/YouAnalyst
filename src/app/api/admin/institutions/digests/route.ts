import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import {
  cleanupInstitutionDigestDryRuns,
  listRecentInstitutionDigestRuns,
  runInstitutionDigest,
} from "@/lib/securities/institution-follows";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AdminInstitutionDigestRequest = {
  action?: unknown;
  dryRun?: unknown;
  limitUsers?: unknown;
  limitItems?: unknown;
  userIds?: unknown;
  confirmCheckpoint?: unknown;
  olderThanDays?: unknown;
  limit?: unknown;
};

async function assertAdmin(request: NextRequest): Promise<NextResponse | null> {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdminUser(decoded)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readUserIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const userIds = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return userIds.length > 0 ? userIds : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readLimit(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return readNumber(value);
}

export async function GET(request: NextRequest) {
  const adminError = await assertAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    const items = await listRecentInstitutionDigestRuns(readLimit(request.nextUrl.searchParams.get("limit")));
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load institution digest runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const adminError = await assertAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    let payload: AdminInstitutionDigestRequest;
    try {
      payload = await request.json() as AdminInstitutionDigestRequest;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const action = readString(payload.action) ?? "run";
    if (action === "cleanupDryRuns") {
      const dryRun = readBoolean(payload.dryRun) ?? true;
      const result = await cleanupInstitutionDigestDryRuns({
        dryRun,
        olderThanDays: readNumber(payload.olderThanDays),
        limit: readNumber(payload.limit),
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action !== "run") {
      return NextResponse.json({ error: "Unsupported institution digest action." }, { status: 400 });
    }

    const dryRun = readBoolean(payload.dryRun) ?? true;
    if (!dryRun && payload.confirmCheckpoint !== true) {
      return NextResponse.json({ error: "Live digest runs require checkpoint confirmation." }, { status: 400 });
    }

    const result = await runInstitutionDigest({
      dryRun,
      limitUsers: readNumber(payload.limitUsers),
      limitItems: readNumber(payload.limitItems),
      userIds: readUserIds(payload.userIds),
    });

    return NextResponse.json({
      ok: true,
      action,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run institution digest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
