import { isInternalRequest } from "@/lib/firebase/auth";
import { runInstitutionDigest } from "@/lib/securities/institution-follows";
import { NextRequest, NextResponse } from "next/server";

type InstitutionDigestRequest = {
  dryRun?: unknown;
  limitUsers?: unknown;
  limitItems?: unknown;
  userIds?: unknown;
};

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readUserIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const userIds = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return userIds.length > 0 ? userIds : undefined;
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let payload: InstitutionDigestRequest;
    try {
      payload = await request.json() as InstitutionDigestRequest;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const result = await runInstitutionDigest({
      dryRun: readBoolean(payload.dryRun),
      limitUsers: readNumber(payload.limitUsers),
      limitItems: readNumber(payload.limitItems),
      userIds: readUserIds(payload.userIds),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run institution digest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
