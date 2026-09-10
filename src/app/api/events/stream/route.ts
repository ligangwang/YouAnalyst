import { subscribePublicEvents } from "@/lib/events/service";
import { eventStreamResponse } from "@/lib/events/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return eventStreamResponse(request, subscribePublicEvents);
}
