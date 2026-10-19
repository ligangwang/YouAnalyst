import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { DEFAULT_COMPARE_APPEARANCE, parseCompareAppearance } from "@/lib/compare-appearance";
import { CompareProfileNotReadyError, saveCompareAppearance } from "@/lib/compare-preferences-service";

const headers = { "Cache-Control": "private, no-store" };
async function userId(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return null;
  try { return (await verifyIdToken(bearer.slice(7))).uid; } catch { return null; }
}

export async function GET(request: NextRequest) {
  const uid = await userId(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const snapshot = await getAdminFirestore().collection("users").doc(uid).get();
    return NextResponse.json({ appearance: parseCompareAppearance(snapshot.data()?.compareAppearance) ?? DEFAULT_COMPARE_APPEARANCE }, { headers });
  } catch { return NextResponse.json({ error: "Preferences unavailable" }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest) {
  const uid = await userId(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const appearance = parseCompareAppearance(await request.json().catch(() => null));
  if (!appearance) return NextResponse.json({ error: "Invalid comparison preferences" }, { status: 400, headers });
  try {
    // Replace this field, including removed overrides, without changing other profile fields.
    await saveCompareAppearance(getAdminFirestore(), uid, appearance);
    return NextResponse.json({ appearance }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CompareProfileNotReadyError ? error.message : "Could not save preferences" }, { status: error instanceof CompareProfileNotReadyError ? 409 : 503, headers });
  }
}
