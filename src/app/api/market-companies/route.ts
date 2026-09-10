import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { listChinaCompanies } from "@/lib/industry-research/china-directory";
import { validChinaId } from "@/lib/industry-research/china";

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor") ?? "";
  if (cursor && !validChinaId(cursor)) return NextResponse.json({ error: "Invalid company cursor." }, { status: 400 });
  try {
    return NextResponse.json(await listChinaCompanies(getAdminFirestore(), cursor), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Company directory is temporarily unavailable." }, { status: 503 });
  }
}
