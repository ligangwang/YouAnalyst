import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { parsePreferences } from "@/lib/preferences";

const headers = { "Cache-Control": "private, no-store" };
async function authenticatedUser(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return null;
  try { return (await verifyIdToken(bearer.slice(7))).uid; } catch { return null; }
}
export async function GET(request: NextRequest) {
  const uid = await authenticatedUser(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const snapshot = await getAdminFirestore().collection("users").doc(uid).get();
    return NextResponse.json({ preferences: parsePreferences(snapshot.data()?.displayPreferences) }, { headers });
  } catch { return NextResponse.json({ error: "Preferences unavailable" }, { status: 503, headers }); }
}
export async function PATCH(request: NextRequest) {
  const uid = await authenticatedUser(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const input = await request.json().catch(() => null);
  if (!parsePreferences(input)) return NextResponse.json({ error: "Invalid preferences" }, { status: 400, headers });
  try {
    const document = getAdminFirestore().collection("users").doc(uid);
    const snapshot = await document.get();
    // Older clients changing language must not reset the newer appearance fields.
    const preferences = parsePreferences({ ...parsePreferences(snapshot.data()?.displayPreferences), ...input });
    await document.set({ displayPreferences: preferences }, { merge: true });
    return NextResponse.json({ preferences }, { headers });
  } catch { return NextResponse.json({ error: "Could not save preferences" }, { status: 503, headers }); }
}
