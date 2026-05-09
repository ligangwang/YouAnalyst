import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import {
  followInstitution,
  getInstitutionFollowState,
  unfollowInstitution,
} from "@/lib/securities/institution-follows";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ cik: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ isFollowing: false });
  }

  const { cik } = await context.params;
  const state = await getInstitutionFollowState(cik, decoded.uid);
  if (!state) {
    return NextResponse.json({ error: "Institution not found" }, { status: 404 });
  }

  return NextResponse.json(state);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ cik: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { cik } = await context.params;
    const institution = await followInstitution(cik, decoded.uid);
    if (!institution) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    return NextResponse.json({ isFollowing: true, institution });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to follow institution";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ cik: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { cik } = await context.params;
    const result = await unfollowInstitution(cik, decoded.uid);
    if (!result) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    return NextResponse.json({ isFollowing: false, cik: result.cik });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to unfollow institution";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
