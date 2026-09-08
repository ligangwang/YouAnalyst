import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/firebase/auth";
import { prepareTopCall, recordTopCallPublication } from "@/lib/social/top-call-service";
import { easternDate, validDate } from "@/lib/social/top-call-writing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  const date = payload?.date ?? easternDate();
  if (!payload || !validDate(date) || date > easternDate()) {
    return NextResponse.json({ error: "Expected JSON with an optional past or current YYYY-MM-DD date" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prepareTopCall(date));
  } catch {
    // Do not send provider responses, source content or credentials to clients/logs.
    return NextResponse.json({ error: "Draft generation failed validation or is unavailable; retry or review source data" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isInternalRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  if (!payload || !validDate(payload.date) || typeof payload.postId !== "string" ||
      !/^\d{1,30}$/.test(payload.postId) || typeof payload.text !== "string" || payload.text.length > 1000) {
    return NextResponse.json({ error: "Expected date, numeric X postId, and exact published text" }, { status: 400 });
  }
  try {
    return NextResponse.json(await recordTopCallPublication(payload.date, payload.postId, payload.text));
  } catch {
    return NextResponse.json({ error: "Publication does not match draft or conflicts with existing publication" }, { status: 409 });
  }
}
