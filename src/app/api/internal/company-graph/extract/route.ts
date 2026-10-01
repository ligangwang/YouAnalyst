import { isInternalRequest } from "@/lib/firebase/auth";
import { dispatchAdminCompanyGraph } from "@/lib/company-graph/admin-dispatch";
import { NextRequest, NextResponse } from "next/server";

type CompanyGraphExtractRequest = {
  ticker?: unknown;
  dryRun?: unknown;
  force?: unknown;
  direct?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as CompanyGraphExtractRequest;
    const ticker = readString(payload.ticker);

    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    const result = await dispatchAdminCompanyGraph({
      ticker,
      dryRun: readBoolean(payload.dryRun) ?? true,
      direct: readBoolean(payload.direct),
      force: readBoolean(payload.force),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    }, { status: "status" in result && result.status !== "AVAILABLE" ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to extract company graph";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
