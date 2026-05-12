import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getInsiderOpsSummary } from "@/lib/securities/insider-ops";
import { NextRequest, NextResponse } from "next/server";

async function assertAdmin(request: NextRequest): Promise<NextResponse | null> {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdminUser(decoded)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function GET(request: NextRequest) {
  const adminError = await assertAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    return NextResponse.json(await getInsiderOpsSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load insider transaction operations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
