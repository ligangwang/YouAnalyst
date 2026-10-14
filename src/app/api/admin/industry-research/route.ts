import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json(
    { error: "US and A-share AI research jobs are retired. Company directory imports remain available in /admin/jobs." },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
export const GET = retired;
export const POST = retired;
