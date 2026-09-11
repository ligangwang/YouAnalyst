import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { listCandidates, refreshCandidates, processCandidates, publishCandidate } from "@/lib/industry-research/service";
import { record, text } from "@/lib/industry-research/model";

export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdminUser(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const db = getAdminFirestore();
    const [page, sync] = await Promise.all([listCandidates(request.nextUrl.searchParams.get("status") ?? "", request.nextUrl.searchParams.get("after") ?? ""), db.collection("directory_syncs").doc("CN_A_CNI").get()]);
    return NextResponse.json({ ...page, sync: sync.data() ?? null, industries: sync.data()?.industries ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Company directory unavailable." }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdminUser(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = record(await request.json());
    if (body.action === "refresh") await refreshCandidates();
    else if (body.action === "process") return NextResponse.json(await processCandidates(text(body.requestId), user.uid, text(body.retryId)));
    else if (body.action === "publish") await publishCandidate(text(body.id), user.uid);
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Research failed." }, { status: 400 }); }
}
