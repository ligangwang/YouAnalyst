import type { PublicEventPage } from "./service";

type Subscribe = (next: (page: PublicEventPage) => void, error: () => void) => () => void;

export function eventStreamResponse(request: Request, subscribe: Subscribe): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe(); clearInterval(heartbeat); clearTimeout(expiry);
        request.signal.removeEventListener("abort", finish);
        try { controller.close(); } catch { /* The consumer may already have canceled. */ }
      };
      cleanup = finish;
      const send = (value: string) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) < -2) { finish(); return; }
        try { controller.enqueue(encoder.encode(value)); } catch { finish(); }
      };
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) { finish(); return; }
      send("retry: 3000\n\n");
      try {
        unsubscribe = subscribe(page => send(`event: snapshot\ndata: ${JSON.stringify(page)}\n\n`), () => {
          send("event: unavailable\ndata: {}\n\n"); finish();
        });
        if (closed) { unsubscribe(); return; }
        heartbeat = setInterval(() => send(": heartbeat\n\n"), 15_000);
        // Reconnect before Cloud Run's default five-minute request timeout.
        expiry = setTimeout(finish, 240_000);
      } catch { send("event: unavailable\ndata: {}\n\n"); finish(); }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
