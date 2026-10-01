import { isInternalRequest } from "@/lib/firebase/auth";
import {
  normalizeCompanyGraphQueueLimit,
  processQueuedCompanyGraphRequests,
  publishQueuedCompanyGraphRequests,
} from "@/lib/company-graph/queue-worker";
import { NextRequest, NextResponse } from "next/server";

type ProcessQueueRequest = {
  limit?: unknown;
  force?: unknown;
  direct?: unknown;
};

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as ProcessQueueRequest;
    if (payload.force === true) return NextResponse.json({ error: "Queue-wide force is no longer supported. Use the authorized extract endpoint with an explicit ticker and force:true." }, { status: 400 });
    const runQueue = process.env.COMPANY_GRAPH_REQUEST_TOPIC && payload.direct !== true
      ? publishQueuedCompanyGraphRequests : processQueuedCompanyGraphRequests;
    const result = await runQueue({
      limit: normalizeCompanyGraphQueueLimit(payload.limit),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process company graph queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
