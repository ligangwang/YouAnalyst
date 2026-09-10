import { subscribePublicEvents } from "@/lib/events/service";
import { eventStreamResponse } from "@/lib/events/stream";
import { parseEventFilter } from "@/lib/events/filters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  let type;
  try { type = parseEventFilter(new URL(request.url).searchParams.get("type")); }
  catch { return Response.json({ error: "Invalid event type" }, { status: 400 }); }
  return eventStreamResponse(request, (next, error) => subscribePublicEvents(next, error, type));
}
