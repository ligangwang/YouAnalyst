import type { NextRequest } from "next/server";
import { runWorkerResponse } from "@/lib/admin-jobs/run-sec";
export async function POST(request: NextRequest) { return runWorkerResponse("directory", request); }
