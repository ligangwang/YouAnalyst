import type { NextRequest } from "next/server";
import { graphBudgetResponse } from "@/lib/company-graph/budget-http";

export async function GET(request: NextRequest) { return graphBudgetResponse(request); }
export async function PATCH(request: NextRequest) { return graphBudgetResponse(request); }
