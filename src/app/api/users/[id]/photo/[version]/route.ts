import { NextRequest } from "next/server";
import { getAdminStorageBucket } from "@/lib/firebase/admin";
import { photoStoragePath } from "@/lib/users/photo";

export const runtime = "nodejs";

// Avatars are public, like the existing Google profile images.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(version)) return new Response(null, { status: 404 });
  try {
    const [image] = await getAdminStorageBucket().file(photoStoragePath(id, version)).download();
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const missing = (error as { code?: number }).code === 404;
    return new Response(null, { status: missing ? 404 : 503 });
  }
}
