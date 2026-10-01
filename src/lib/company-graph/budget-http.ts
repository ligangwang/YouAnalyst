import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getGraphBudgetSummary, setGraphBudgetLimit } from "@/lib/company-graph/budget";
import { maintenanceError } from "@/lib/maintenance-log";

const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function graphBudgetResponse(request: NextRequest, dependencies = {
  getUser: getDecodedUserFromRequest,
  isAdmin: isAdminUser,
  load: getGraphBudgetSummary,
  update: setGraphBudgetLimit,
}) {
  const user = await dependencies.getUser(request);
  if (!user) return reply({ error: "Unauthorized" }, 401);
  if (!await dependencies.isAdmin(user)) return reply({ error: "Forbidden" }, 403);
  if (request.method !== "GET" && request.method !== "PATCH") return reply({ error: "Method not allowed" }, 405);

  let limitUsd: number | undefined;
  if (request.method === "PATCH") {
    const body: unknown = await request.json().catch(() => null);
    const value = body && typeof body === "object" && !Array.isArray(body) && "limitUsd" in body ? body.limitUsd : undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000 || Math.round(value * 100) / 100 !== value) {
      return reply({ error: "Enter a daily limit from US$0 to US$1,000,000 with no more than two decimal places." }, 400);
    }
    limitUsd = value;
  }

  try {
    return reply(limitUsd === undefined ? await dependencies.load() : await dependencies.update(limitUsd));
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", event: "admin_graph_budget_failed", action: request.method === "GET" ? "read" : "update", requestedBy: user.uid, error: maintenanceError(error) }));
    return reply({ error: request.method === "GET" ? "Unable to load the company graph budget. Retry to see the current limit and usage." : "Unable to save the company graph budget. Refresh the budget to check the current limit before retrying." }, 503);
  }
}
