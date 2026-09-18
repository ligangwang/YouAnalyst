import { FILING_FEATURES_ENABLED } from "../../src/lib/feature-flags";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore, QuerySnapshot } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/events/route";
import { GET as stream } from "../../src/app/api/events/stream/route";
import { parseEventFilter } from "../../src/lib/events/filters";
import { listPublicEvents, subscribePublicEvents } from "../../src/lib/events/service";

test("both endpoints reject unsupported types before accessing Firestore", async () => {
  for (const type of ["private", "", "SEC_FORM4,SEC_13F", "sec_form4"]) {
    assert.throws(() => parseEventFilter(type));
    const url = `https://youanalyst.com/api/events?type=${encodeURIComponent(type)}`;
    assert.equal((await GET(new NextRequest(url))).status, 400);
    assert.equal(stream(new Request(url)).status, 400);
  }
  assert.equal(parseEventFilter(null), "all");
});

test("filtered pagination and shared live listeners query the same category and order", { skip: !FILING_FEATURES_ENABLED }, async () => {
  const queries: unknown[][] = [];
  const listeners: { next: (page: QuerySnapshot) => void; error: () => void; stopped: boolean }[] = [];
  const empty = { docs: [], size: 0 } as unknown as QuerySnapshot;
  const db = { collection: (name: string) => {
    assert.equal(name, "events");
    const calls: unknown[] = []; queries.push(calls);
    const query = {
      where: (...args: unknown[]) => { calls.push(["where", ...args]); return query; },
      orderBy: (field: unknown, direction: string) => { calls.push(["order", typeof field === "string" ? field : "__name__", direction]); return query; },
      startAfter: (...args: unknown[]) => { calls.push(["after", ...args]); return query; },
      limit: (n: number) => { calls.push(["limit", n]); return query; },
      get: async () => empty,
      onSnapshot: (next: (page: QuerySnapshot) => void, error: () => void) => {
        const listener = { next, error, stopped: false }; listeners.push(listener);
        return () => { listener.stopped = true; };
      },
    };
    return query;
  } } as unknown as Firestore;
  const cursor = { publishedAt: "2026-09-10T12:00:00.000Z", id: "sec_form4-0001234567-26-000001" };
  await listPublicEvents({ type: "SEC_FORM4", cursor }, db);
  assert.deepEqual(queries[0], [["where", "type", "==", "SEC_FORM4"], ["order", "publishedAt", "desc"], ["order", "__name__", "desc"], ["after", cursor.publishedAt, cursor.id], ["limit", 31]]);
  let insiderUpdates = 0; let holdingUpdates = 0; let failures = 0;
  const stopA = subscribePublicEvents(() => insiderUpdates++, () => failures++, "SEC_FORM4", db);
  const stopB = subscribePublicEvents(() => insiderUpdates++, () => failures++, "SEC_FORM4", db);
  const stopC = subscribePublicEvents(() => holdingUpdates++, () => failures++, "SEC_13F", db);
  try {
    assert.equal(listeners.length, 2);
    assert.deepEqual(queries[1].slice(0, 3), queries[0].slice(0, 3));
    assert.deepEqual(queries[2][0], ["where", "type", "==", "SEC_13F"]);
    listeners[0].next(empty);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(insiderUpdates, 2); assert.equal(holdingUpdates, 0);
    stopA(); assert.equal(listeners[0].stopped, false);
    stopB(); assert.equal(listeners[0].stopped, true);
    listeners[1].error(); assert.equal(failures, 1);
    assert.equal(listeners[1].stopped, true);
  } finally { stopA(); stopB(); stopC(); }
});


test("paused filing feeds return no records and do not open queries or listeners", async () => {
  assert.equal(stream(new Request("https://youanalyst.com/api/events/stream")).status, 204);
  const db = { collection: () => { throw new Error("Unexpected filing query"); } } as unknown as Firestore;
  for (const type of ["all", "SEC_FORM4", "SEC_13F"] as const) {
    assert.deepEqual(await listPublicEvents({ type }, db), { items: [], nextCursor: null });
    let snapshots = 0;
    const stop = subscribePublicEvents(page => { snapshots++; assert.deepEqual(page, { items: [], nextCursor: null }); }, () => assert.fail("Unexpected failure"), type, db);
    stop();
    assert.equal(snapshots, 1);
  }
});
