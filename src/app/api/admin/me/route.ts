import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }

  try {
    return NextResponse.json({
      isAdmin: await isAdminUser(decoded),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to resolve admin status:", error);
    return NextResponse.json({ error: "Failed to resolve admin status." }, { status: 500 });
  }
}
