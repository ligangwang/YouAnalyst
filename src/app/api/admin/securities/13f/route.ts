import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getThirteenFOpsSummary } from "@/lib/securities/thirteen-f-ops";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdminUser(decoded)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await getThirteenFOpsSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load 13F operations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
