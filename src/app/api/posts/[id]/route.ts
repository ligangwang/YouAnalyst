import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { readPost } from "@/lib/posts/service";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDecodedUserFromRequest(request);
  const post = await readPost((await params).id, user?.uid);
  return NextResponse.json(post ?? { error: "Post not found" }, { status: post ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
}
