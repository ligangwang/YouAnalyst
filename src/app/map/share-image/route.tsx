import { createMapShareImage } from "@/lib/map-share-card";

export const runtime = "nodejs";

export function GET(request: Request) {
  return createMapShareImage(new URL(request.url).searchParams.get("company") === "NVDA");
}
