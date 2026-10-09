import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";

async function loadRoute(path: string) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{
    name: "isolated-route-services",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(firebase\/(auth|admin)|predictions\/service)$/ }, args => ({ path: args.path, namespace: "isolated" }));
      builder.onLoad({ filter: /.*/, namespace: "isolated" }, args => ({ loader: "ts", contents: args.path.endsWith("/auth")
        ? 'export async function getDecodedUserFromRequest(request) { return request.headers.get("authorization") === "Bearer human" ? {uid:"alice"} : null; }'
        : args.path.endsWith("/admin") ? 'export function getAdminFirestore() { throw new Error("Retired creation must not access Firestore"); }'
        : 'export const PUBLIC_FEED_PREVIEW_LIMIT=10; export async function listPredictions() { throw new Error("Creation must not list predictions"); } export async function createPrediction() { throw new Error("Uncited creation was invoked"); } export async function createPredictionForUser() { throw new Error("Uncited creation was invoked"); } export function validateCreatePredictionInput(input) { return input; }' }));
    },
  }] });
  const loaded = { exports: {} as { POST: (request: NextRequest, context: {params: Promise<{symbol:string}>}) => Promise<Response> } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

for (const route of ["src/app/api/predictions/route.ts", "src/app/api/ticker/[symbol]/position/route.ts"]) {
  test(`${route} rejects uncited creation and supplies the publishing route`, async () => {
    const { POST } = await loadRoute(route);
    const context = { params: Promise.resolve({ symbol: "amd" }) };
    const anonymous = await POST(new NextRequest("https://youanalyst.com/api", { method: "POST" }), context);
    assert.equal(anonymous.status, 401);
    // Claiming the internal AI source in an external payload cannot revive the shortcut.
    const response = await POST(new NextRequest("https://youanalyst.com/api", { method: "POST", headers: { authorization: "Bearer human", "content-type": "application/json" }, body: JSON.stringify({ticker:"KO",direction:"UP",sourceType:"AI_ANALYST"}) }), context);
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.match(body.error, /evidence-backed/);
    assert.equal(new URL(body.publishUrl, "https://youanalyst.com").pathname, "/predictions/new");
    if (route.includes("position")) assert.equal(new URL(body.publishUrl, "https://youanalyst.com").searchParams.get("ticker"), "AMD");
  });
}
