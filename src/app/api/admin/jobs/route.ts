import type { NextRequest } from "next/server";
import { jobHistoryResponse } from "@/lib/admin-jobs/http";
import { rerunEodResponse } from "@/lib/admin-jobs/rerun";
export const maxDuration = 300;
export async function GET(request: NextRequest) { return jobHistoryResponse(request); }
export async function POST(request: NextRequest) { return rerunEodResponse(request); }
