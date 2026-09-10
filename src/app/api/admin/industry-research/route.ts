import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { listResearch, publishResearch, refreshResearch, startResearch } from "@/lib/industry-research/service";
import { record, text } from "@/lib/industry-research/model";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { seedChinaCompanies } from "@/lib/industry-research/china-directory";

export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser(user))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ items: await listResearch() }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser(user))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = record(await request.json());
    if (body.action === "seed-china") return NextResponse.json(await seedChinaCompanies(getAdminFirestore(), user.uid), { headers: { "Cache-Control": "private, no-store" } });
    if (body.action === "start" && body.market !== undefined && !["US", "CN_A"].includes(body.market as string)) return NextResponse.json({ error: "Invalid research market." }, { status: 400 });
    let item;
    if (body.action === "start") item = await startResearch(text(body.industry), text(body.requestId), user.uid, body.category, body.market === "CN_A" ? "CN_A" : "US");
    else if (body.action === "refresh") item = await refreshResearch(text(body.id));
    else if (body.action === "publish" && Array.isArray(body.selectedIds)) item = await publishResearch(text(body.id), body.selectedIds, user.uid);
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    return NextResponse.json({ item }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Research operation failed." }, { status: 400 });
  }
}
