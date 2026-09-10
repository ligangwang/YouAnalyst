import test from "node:test";
import assert from "node:assert/strict";
import { eventStreamResponse } from "../../src/lib/events/stream";

test("stream delivers snapshots and detaches its listener on disconnect", async () => {
  const abort = new AbortController();
  let stops = 0;
  let emit: Parameters<typeof eventStreamResponse>[1] extends (next: infer T, ...args: never[]) => unknown ? T : never;
  const response = eventStreamResponse(new Request("https://example.test", { signal: abort.signal }), next => { emit = next; return () => { stops++; }; });
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /retry: 3000/);
  emit!({ items: [], nextCursor: null });
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: snapshot\ndata: \{"items":\[\],"nextCursor":null\}/);
  abort.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(stops, 1);
});

test("cancel and synchronous listener failure clean up without exposing errors", async () => {
  let stops = 0;
  const response = eventStreamResponse(new Request("https://example.test"), (_next, fail) => { fail(); return () => { stops++; }; });
  const body = await response.text();
  assert.match(body, /event: unavailable/);
  assert.equal(stops, 1);
  const another = eventStreamResponse(new Request("https://example.test"), () => () => { stops++; });
  await another.body!.cancel();
  assert.equal(stops, 2);
});
