import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { getOrCreateDefaultWatchlistForUser } from "../../src/lib/watchlists/service";

type Data = Record<string, unknown>;
function fixture(initial: Record<string, Data> = {}, profileExists = true) {
  const records = new Map(Object.entries(initial));
  const writes: Data[] = [];
  let nextId = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (collection: string) => ({
      doc: (id = `new-${++nextId}`) => ({ collection, id }),
      where: (_field: string, _op: string, userId: string) => ({ collection, userId }),
    }),
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      // Model serializable transactions, including concurrent initialization calls.
      const result = tail.then(() => fn({
        get: async (ref: { collection: string; userId?: string }) => ref.collection === "users"
          ? { exists: profileExists }
          : { docs: [...records].filter(([, data]) => data.userId === ref.userId).map(([id, data]) => ({ id, data: () => data })) },
        set: (ref: { id: string }, data: Data) => { records.set(ref.id, data); writes.push(data); },
        update: (_ref: unknown, data: Data) => writes.push(data),
      }));
      tail = result.catch(() => {});
      return result;
    },
  } as unknown as Firestore;
  return { db, records, writes };
}

test("concurrent and repeated initialization creates one default with one active count", async () => {
  const f = fixture();
  const ids = await Promise.all(Array.from({ length: 4 }, () => getOrCreateDefaultWatchlistForUser("alice", undefined, f.db)));
  assert.equal(new Set(ids).size, 1);
  assert.equal(f.records.size, 1);
  assert.equal(f.records.get(ids[0])?.name, "My Watchlist");
  assert.equal(f.records.get(ids[0])?.isPublic, true);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1]["stats.watchlistCount"], 1);
});

test("reuse oldest active owned list, including private lists, without changing it", async () => {
  const f = fixture({
    foreign: { userId: "bob", name: "Other", createdAt: "2020" },
    archived: { userId: "alice", name: "Old", createdAt: "2021", archivedAt: "2022" },
    latest: { userId: "alice", name: "Latest", createdAt: "2025", isPublic: true },
    oldest: { userId: "alice", name: "Private research", createdAt: "2024", isPublic: false },
  });
  assert.equal(await getOrCreateDefaultWatchlistForUser("alice", undefined, f.db), "oldest");
  assert.equal(f.writes.length, 0);
});

test("archived lists remain archived and users without profiles cannot create defaults", async () => {
  const f = fixture({ old: { userId: "alice", archivedAt: "2025", createdAt: "2024" } });
  const id = await getOrCreateDefaultWatchlistForUser("alice", undefined, f.db);
  assert.notEqual(id, "old");
  assert.equal(f.records.get("old")?.archivedAt, "2025");
  const missing = fixture({}, false);
  await assert.rejects(getOrCreateDefaultWatchlistForUser("alice", undefined, missing.db), /profile not found/);
  assert.equal(missing.writes.length, 0);
});
