import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminAuth, getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase/admin";
import { MAX_PHOTO_BYTES, normalizePhoto, photoStoragePath } from "@/lib/users/photo";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await getDecodedUserFromRequest(request);
  if (!user || user.uid !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const ref = getAdminFirestore().collection("users").doc(id);
    if (!(await ref.get()).exists) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json().catch(() => null);
      if (body?.source !== "google") return NextResponse.json({ error: "Invalid photo source" }, { status: 400 });
      const account = await getAdminAuth().getUser(id);
      const google = account.providerData.find((provider) => provider.providerId === "google.com");
      if (!google) return NextResponse.json({ error: "Sign in with a linked Google account to use its photo." }, { status: 400 });
      const photoURL = google.photoURL ?? null;
      await ref.update({ photoURL, photoSource: "google", updatedAt: new Date().toISOString() });
      return NextResponse.json({ photoURL });
    }

    // Read a bounded raw body rather than buffering an arbitrarily large multipart upload.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "Choose an image under 5 MB." }, { status: 413 });
      }
      chunks.push(value);
    }
    let image: Buffer;
    try {
      image = await normalizePhoto(Buffer.concat(chunks));
    } catch {
      return NextResponse.json({ error: "Choose a valid JPEG, PNG, or WebP image under 5 MB and 25 megapixels." }, { status: 400 });
    }
    const version = randomUUID();
    const file = getAdminStorageBucket().file(photoStoragePath(id, version));
    await file.save(image, { resumable: false, contentType: "image/webp" });
    const photoURL = `/api/users/${encodeURIComponent(id)}/photo/${version}`;
    try {
      await ref.update({ photoURL, photoSource: "custom", updatedAt: new Date().toISOString() });
    } catch (error) {
      await file.delete().catch(() => undefined);
      throw error;
    }
    return NextResponse.json({ photoURL });
  } catch (error) {
    console.error("Unable to update profile photo", error);
    return NextResponse.json({ error: "Unable to update your photo. Please try again." }, { status: 500 });
  }
}
