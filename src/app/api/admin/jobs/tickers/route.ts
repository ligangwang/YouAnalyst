import type { NextRequest } from "next/server";
import { runTickerResponse } from "@/lib/admin-jobs/tickers";
export const maxDuration = 300;
export async function POST(request: NextRequest) { return runTickerResponse(request); }
