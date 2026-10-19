import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "ifindata-web",
    status: "ok",
    entityCache: "local-push",
    environment: process.env.APP_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    revision: process.env.K_REVISION ?? null,
    commitSha: process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    timestamp: new Date().toISOString(),
  });
}