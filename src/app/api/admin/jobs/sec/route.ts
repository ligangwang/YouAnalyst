import type { NextRequest } from "next/server";
import { runSecResponse } from "@/lib/admin-jobs/run-sec";
export async function POST(request: NextRequest) { return runSecResponse(request); }
