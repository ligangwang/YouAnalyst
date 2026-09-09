import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { listResearch, publishResearch, refreshResearch, startResearch } from "@/lib/industry-research/service";
import { record, text } from "@/lib/industry-research/model";

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
    let item;
    if (body.action === "start") item = await startResearch(text(body.industry), text(body.requestId), user.uid);
    else if (body.action === "refresh") item = await refreshResearch(text(body.id));
    else if (body.action === "publish" && Array.isArray(body.selectedIds)) item = await publishResearch(text(body.id), body.selectedIds, user.uid);
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    return NextResponse.json({ item }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Research operation failed." }, { status: 400 });
  }
}
