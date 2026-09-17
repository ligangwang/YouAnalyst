import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { validatePost } from "@/lib/posts/model";
import { listPosts, publishPost } from "@/lib/posts/service";

export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  const params = request.nextUrl.searchParams;
  const items = await listPosts({ predictionId: params.get("predictionId") ?? undefined, ticker: params.get("ticker") ?? undefined, userId: params.get("userId") ?? undefined }, user?.uid);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await publishPost(validatePost(await request.json()), { uid: user.uid, displayName: user.name, photoURL: user.picture }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish" }, { status: 400 });
  }
}
