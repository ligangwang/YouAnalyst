import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { addComparisonComment, listComparisonComments, listCommunityComparisons, publishComparison, readCommunityComparison, resolveCompareLanding, voteOnComparison } from "../../src/lib/compare-community-service";
import { validateComparisonSubmission, comparisonVoteTotals, type CommunityComparison } from "../../src/lib/compare-community";
import { DEFAULT_COMPARE_APPEARANCE, companyCompareColor } from "../../src/lib/compare-appearance";
import { GET as getDetail } from "../../src/app/api/compare/community/[id]/route";
import { POST as postCommunity } from "../../src/app/api/compare/community/route";
import { POST as postVote } from "../../src/app/api/compare/community/[id]/vote/route";
import { POST as postComment } from "../../src/app/api/compare/community/[id]/comments/route";
import { NextRequest } from "next/server";

type Data = Record<string, unknown>;
type Snapshot = { ref: { path: string; id: string }; id: string; exists: boolean; data: () => Data | undefined; get: (field: string) => unknown };
function fixture() {
  const records = new Map<string, Data>([...Array.from({ length: 12 }, (_, i) => [`users/user${i}`, { nickname: `Analyst ${i}`, settings: { isPublic: true } }] as [string, Data]), ["users/private", { settings: { isPublic: false } }]]);
  const value = (data: Data | undefined, field: string): unknown => field.split(".").reduce<unknown>((item, key) => item && typeof item === "object" ? (item as Data)[key] : undefined, data);
  function doc(path: string) {
    return { path, id: path.split("/").at(-1)!, collection: (name: string) => collection(path + "/" + name), get: async () => snapshot(path, records) };
  }
  function snapshot(path: string, data: Map<string, Data>): Snapshot {
    return { ref: doc(path), id: path.split("/").at(-1)!, exists: data.has(path), data: () => data.get(path), get: (field: string) => value(data.get(path), field) };
  }
  function collection(path: string) {
    const filters: [string, unknown][] = [], orders: [string, string][] = [];
    let count = 100, after: unknown[] | null = null;
    const query = {
      doc: (id: string) => doc(`${path}/${id}`),
      where: (field: string, _op: string, expected: unknown) => { filters.push([field, expected]); return query; },
      orderBy: (field: unknown, direction = "asc") => { orders.push([typeof field === "string" ? field : "__name__", direction]); return query; },
      startAfter: (...values: unknown[]) => { after = values; return query; },
      limit: (limit: number) => { count = limit; return query; },
      get: async () => {
        let rows = [...records.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")).map(key => snapshot(key, records)).filter(row => filters.every(([field, expected]) => row.get(field) === expected));
        const sortValue = (row: ReturnType<typeof snapshot>, field: string) => field === "__name__" ? row.id : row.get(field);
        rows.sort((a, b) => { for (const [field, direction] of orders) { const aValue = sortValue(a, field) as string | number, bValue = sortValue(b, field) as string | number; if (aValue !== bValue) return (aValue < bValue ? -1 : 1) * (direction === "desc" ? -1 : 1); } return 0; });
        if (after) rows = rows.filter(row => { for (let i = 0; i < orders.length; i++) { const current = sortValue(row, orders[i][0]) as string | number, cursor = after![i] as string | number; if (current !== cursor) return (current < cursor ? -1 : 1) * (orders[i][1] === "desc" ? -1 : 1) > 0; } return false; });
        return { docs: rows.slice(0, count) };
      },
    };
    return query;
  }
  let tail: Promise<unknown> = Promise.resolve();
  const db = { collection, runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const result = tail.then(async () => {
      const working = new Map(records);
      let wrote = false;
      const result = await fn({
        get: async (ref: { path: string }) => { assert.equal(wrote, false, "transaction reads precede writes"); return snapshot(ref.path, working); },
        create: (ref: { path: string }, data: Data) => { wrote = true; assert.equal(working.has(ref.path), false); working.set(ref.path, data); },
        set: (ref: { path: string }, data: Data) => { wrote = true; working.set(ref.path, data); },
        update: (ref: { path: string }, data: Data) => { wrote = true; assert.ok(working.has(ref.path)); working.set(ref.path, { ...working.get(ref.path), ...data }); },
      });
      records.clear(); for (const [key, data] of working) records.set(key, data);
      return result;
    });
    tail = result.catch(() => {});
    return result;
  } } as unknown as Firestore;
  return { db, records };
}
const input = { title: "Chips over one year", body: "Watch this race.", requestId: "comparison-request-123", comparison: { theme: "dark" as const, config: { symbols: ["AMD", "NVDA"], start: "2025-01-01", end: "2025-12-31", style: "bar" as const, colors: { AMD: "#123456", NVDA: companyCompareColor("NVDA", DEFAULT_COMPARE_APPEARANCE) } } } };

test("shared snapshots validate fixed stocks, periods, colors and style", () => {
  assert.deepEqual(validateComparisonSubmission(input), input);
  for (const patch of [{ symbols: ["AMD", "AMD"] }, { symbols: ["<script>"] }, { start: "2020-01-01" }, { end: "2099-01-01" }, { style: "pie" }, { colors: { AMD: "red", NVDA: "#123456" } }, { colors: { AMD: "#123456" } }]) {
    assert.throws(() => validateComparisonSubmission({ ...input, comparison: { ...input.comparison, config: { ...input.comparison.config, ...patch } } }));
  }
});

test("publishing is immutable and idempotent, attributes the verified user, and excludes private profiles", async () => {
  const f = fixture();
  const result = await publishComparison(input, { uid: "user0", displayName: "Ignored name" }, f.db);
  assert.deepEqual(await publishComparison(input, { uid: "user0" }, f.db), result);
  assert.equal([...f.records.keys()].filter(path => path.startsWith("posts/")).length, 1);
  const post = await readCommunityComparison(result.id, undefined, f.db);
  assert.equal(post?.userId, "user0"); assert.equal(post?.authorName, "Analyst 0"); assert.deepEqual(post?.comparison, input.comparison);
  await assert.rejects(publishComparison({ ...input, comparison: { ...input.comparison, theme: "light" } }, { uid: "user0" }, f.db), /different post/);
  await assert.rejects(publishComparison(input, { uid: "private" }, f.db), /public profile/);
});

test("each account has one vote; repeats, switches, removals and concurrent votes keep exact totals", async () => {
  const f = fixture();
  const { id } = await publishComparison(input, { uid: "user0" }, f.db);
  await Promise.all(Array.from({ length: 10 }, (_, i) => voteOnComparison(id, `user${i}`, 1, f.db)));
  assert.equal(f.records.get(`posts/${id}`)?.netLikes, 10);
  for (let i = 0; i < 5; i++) await voteOnComparison(id, "user0", 1, f.db);
  assert.equal(f.records.get(`posts/${id}`)?.likes, 10);
  assert.deepEqual(await voteOnComparison(id, "user0", -1, f.db), { likes: 9, dislikes: 1, netLikes: 8, viewerVote: -1 });
  assert.deepEqual(await voteOnComparison(id, "user0", 0, f.db), { likes: 9, dislikes: 0, netLikes: 9, viewerVote: 0 });
  assert.equal((await readCommunityComparison(id, "user1", f.db))?.viewerVote, 1);
  await assert.rejects(voteOnComparison(id, "user0", 50, f.db), /Choose like/);
  assert.deepEqual(comparisonVoteTotals(0, 0, 0, -1), { likes: 0, dislikes: 1, netLikes: -1 });
});

test("leaderboard sorts by net votes, uses deterministic ties and paginates without duplicate IDs", async () => {
  const f = fixture();
  for (let i = 0; i < 24; i++) {
    const { id } = await publishComparison({ ...input, requestId: `comparison-request-${i}` }, { uid: "user0" }, f.db);
    f.records.set(`posts/${id}`, { ...f.records.get(`posts/${id}`), createdAt: "2026-01-01T00:00:00.000Z", likes: i, netLikes: i });
  }
  const first = await listCommunityComparisons(null, undefined, f.db), second = await listCommunityComparisons(first.nextCursor, undefined, f.db);
  assert.equal(first.items[0].netLikes, 23);
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 4);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 24);
  const all = [...first.items, ...second.items] as CommunityComparison[];
  for (const row of all) f.records.set(`posts/${row.id}`, { ...f.records.get(`posts/${row.id}`), netLikes: 0 });
  const ties = await listCommunityComparisons(null, undefined, f.db);
  assert.deepEqual(ties.items.map(row => row.id), all.map(row => row.id).sort().reverse().slice(0, 20));
});

test("comments paginate, preserve plain text, and retries never duplicate replies or counters", async () => {
  const f = fixture();
  const { id } = await publishComparison(input, { uid: "user0" }, f.db);
  const reply = { content: "<script>alert(1)</script> is plain text", requestId: "comment-request-12345" };
  const a = await addComparisonComment(id, { uid: "user1" }, reply, f.db);
  assert.deepEqual(await addComparisonComment(id, { uid: "user1" }, reply, f.db), a);
  assert.equal(f.records.get(`posts/${id}`)?.commentCount, 1);
  await assert.rejects(addComparisonComment(id, { uid: "user1" }, { ...reply, content: "changed" }, f.db), /different comment/);
  await assert.rejects(addComparisonComment(id, { uid: "user1" }, { ...reply, content: " " }, f.db), /comment/);
  for (let i = 0; i < 21; i++) await addComparisonComment(id, { uid: "user2" }, { content: `Reply ${i}`, requestId: `comment-request-${i}` }, f.db);
  const first = await listComparisonComments(id, null, f.db), second = await listComparisonComments(id, first.nextCursor, f.db);
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 2); assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 22);
});

test("the highest net score becomes the default with author credit, explicit links win, and failure falls back", async () => {
  const f = fixture();
  const first = await publishComparison(input, { uid: "user0" }, f.db);
  const second = await publishComparison({ ...input, requestId: "another-comparison-request", title: "Community winner" }, { uid: "user1" }, f.db);
  await voteOnComparison(first.id, "user2", -1, f.db);
  await voteOnComparison(second.id, "user2", 1, f.db);
  const winner = (await listCommunityComparisons(null, undefined, f.db)).items[0];
  const result = await resolveCompareLanding(new URLSearchParams(), async () => winner);
  assert.equal(result.featured?.id, second.id); assert.equal(result.featured?.authorName, "Analyst 1"); assert.deepEqual(result.config, input.comparison.config);
  let requested = false;
  const explicit = await resolveCompareLanding(new URLSearchParams({ symbols: "AAPL,MSFT", style: "line" }), async () => { requested = true; return winner; });
  assert.equal(requested, false); assert.equal(explicit.featured, null); assert.deepEqual(explicit.config.symbols, ["AAPL", "MSFT"]);
  const fallback = await resolveCompareLanding(new URLSearchParams(), async () => { throw new Error("index not ready"); });
  assert.equal(fallback.featured, null); assert.deepEqual(fallback.config.symbols, ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"]);
});

test("private authors' comparisons, comments and votes cannot be accessed", async () => {
  const f = fixture();
  const { id } = await publishComparison(input, { uid: "user0" }, f.db);
  f.records.set("users/user0", { settings: { isPublic: false } });
  assert.equal(await readCommunityComparison(id, "user1", f.db), null);
  assert.deepEqual((await listCommunityComparisons(null, "user1", f.db)).items, []);
  await assert.rejects(voteOnComparison(id, "user1", 1, f.db), /not found/);
  await assert.rejects(listComparisonComments(id, null, f.db), /not found/);
  await assert.rejects(addComparisonComment(id, { uid: "user1" }, { content: "test", requestId: "comment-request-12345" }, f.db), /not found/);
});

test("publishing, commenting and voting reject signed-out requests before database access", async () => {
  const context = { params: Promise.resolve({ id: "a".repeat(64) }) };
  for (const handler of [postCommunity, postVote, postComment]) {
    const result = await handler(new NextRequest("https://example.com/api/compare/community", { method: "POST" }), context);
    assert.equal(result.status, 401); assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  const invalid = await getDetail(new NextRequest("https://example.com/api/compare/community/bad"), { params: Promise.resolve({ id: "bad" }) });
  // Infrastructure may be unavailable locally, but invalid IDs never expose data.
  assert.ok([404, 503].includes(invalid.status));
});
