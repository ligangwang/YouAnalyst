import type { NextRequest } from "next/server";
import { jobHistoryResponse } from "@/lib/admin-jobs/http";
export async function GET(request: NextRequest) { return jobHistoryResponse(request); }
