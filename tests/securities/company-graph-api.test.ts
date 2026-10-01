import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { parseCompanyGraphPublisherArgs } from "../../src/lib/company-graph/cli";

test("publisher modes reject contradictory flags and unsafe limits before work", () => {
  assert.deepEqual(parseCompanyGraphPublisherArgs([], {}), { preview: true, verify: false, limit: 1 });
  assert.equal(parseCompanyGraphPublisherArgs(["--apply", "--limit=5"], {}).preview, false);
  assert.equal(parseCompanyGraphPublisherArgs(["--verify-delivery"], {}).verify, true);
  assert.equal(parseCompanyGraphPublisherArgs([], { COMPANY_GRAPH_VERIFY_ONLY: "1" }).verify, true);
  for (const args of [["--apply", "--dry-run"], ["--apply", "--verify-delivery"], ["--verify-delivery", "--limit=2"],
    ["--dryrun"], ["--limit=0"], ["--limit=6"], ["--limit=1.5"], ["--limit=NaN"], ["--apply", "--apply"]]) {
    assert.throws(() => parseCompanyGraphPublisherArgs(args, {}));
  }
  assert.throws(() => parseCompanyGraphPublisherArgs(["--apply"], { COMPANY_GRAPH_VERIFY_ONLY: "1" }));
});
async function routeFixture(route: string) {
  const state = { authenticated: true, admin: true, internal: true, calls: [] as Array<{ fn: string; input: unknown }>,
    result: { ticker: "AMD", status: "QUEUED" } as Record<string, unknown> };
  const code = await build({ entryPoints: [`src/app/api/${route}/route.ts`], bundle: true, write: false, format: "cjs", platform: "node",
    plugins: [{ name: "local-mocks", setup(b) {
      b.onResolve({ filter: /^(?:@\/lib\/|next\/server)/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => {
        const contents = path === "next/server" ? 'export const NextResponse = { json: (value, init) => new Response(JSON.stringify(value), init) };'
          : path.endsWith("firebase/auth") ? 'export const getDecodedUserFromRequest = async () => globalThis.state.authenticated ? {} : null; export const isInternalRequest = () => globalThis.state.internal;'
          : path.endsWith("admin-role") ? 'export const isAdminUser = async () => globalThis.state.admin;'
          : path.endsWith("admin-dispatch") ? 'export const dispatchAdminCompanyGraph = async input => { globalThis.state.calls.push({fn:"dispatch",input}); return globalThis.state.result; };'
          : path.endsWith("queue-worker") ? 'export const normalizeCompanyGraphQueueLimit = x=>Number(x||1); export const publishQueuedCompanyGraphRequests = async input=>{ globalThis.state.calls.push({fn:"publish",input}); return {}; }; export const processQueuedCompanyGraphRequests = async input=>{ globalThis.state.calls.push({fn:"direct",input}); return {}; };'
          : 'export const enqueueCompanyGraphRequest = async input => { globalThis.state.calls.push({fn:"enqueue",input}); return globalThis.state.result; };';
        return { contents, loader: "js" };
      });
    } }] });
  const compiled = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  const env = {} as Record<string, string | undefined>;
  runInNewContext(code.outputFiles[0].text, { module: compiled, exports: compiled.exports, Response, process: { env }, globalThis: { state } });
  const post = (payload: unknown) => compiled.exports.POST(new Request("http://test/api", { method: "POST", body: JSON.stringify(payload) }));
  return { state, env, post };
}
test("internal extraction preserves default preview; explicit false opts into writes", async () => {
  const f = await routeFixture("internal/company-graph/extract");
  await f.post({ ticker: "AMD" }); assert.equal((f.state.calls[0].input as { dryRun: boolean }).dryRun, true);
  await f.post({ ticker: "AMD", dryRun: false }); assert.equal((f.state.calls[1].input as { dryRun: boolean }).dryRun, false);
  f.state.internal = false; assert.equal((await f.post({ ticker: "AMD", dryRun: false })).status, 401);
  assert.equal(f.state.calls.length, 2);
});
test("admin extraction requires authenticated admin before dispatch and accepts asynchronous result", async () => {
  const f = await routeFixture("admin/company-graph/extract");
  f.state.authenticated = false; assert.equal((await f.post({ ticker: "AMD" })).status, 401);
  f.state.authenticated = true; f.state.admin = false; assert.equal((await f.post({ ticker: "AMD" })).status, 403);
  assert.equal(f.state.calls.length, 0);
  f.state.admin = true; assert.equal((await f.post({ ticker: "AMD" })).status, 202);
  assert.equal((f.state.calls[0].input as { dryRun?: boolean }).dryRun, undefined);
});
test("public extraction request remains queue-only and does not forward force/direct fields", async () => {
  const f = await routeFixture("company-graph/requests");
  assert.equal((await f.post({ ticker: "AMD", force: true, direct: true })).status, 200);
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].fn, "enqueue"); assert.equal(f.state.calls[0].input, "AMD");
});
test("queue route defaults to publisher when configured; direct fallback is explicit and force is rejected", async () => {
  const f = await routeFixture("internal/company-graph/process-queue"); f.env.COMPANY_GRAPH_REQUEST_TOPIC = "test";
  assert.equal((await f.post({ force: true })).status, 400); assert.equal(f.state.calls.length, 0);
  await f.post({ limit: 2 }); assert.equal(f.state.calls[0].fn, "publish");
  await f.post({ limit: 2, direct: true }); assert.equal(f.state.calls[1].fn, "direct");
});
