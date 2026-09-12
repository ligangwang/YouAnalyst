import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Only CI's clean Linux checkout may supply a prebuilt deployment.
assert.equal(process.platform, "linux", "Release artifacts must be built on Linux");
assert.equal(process.arch, "x64");
assert.equal(process.versions.node.split(".")[0], "20");
assert.match(process.env.GIT_SHA ?? "", /^[a-f0-9]{40}$/);
assert.ok(["staging", "production"].includes(process.env.APP_ENVIRONMENT));
const root = resolve(".release");
await mkdir(root); // Refuse to mix a previous release with the current build.
await cp("Dockerfile.release", `${root}/Dockerfile.release`);
// A dedicated context retains traced node_modules and .next files, which the
// source-build ignore file intentionally excludes.
await writeFile(`${root}/.gcloudignore`, ".gcloudignore\n.env*\ngha-creds-*.json\n");
await cp(".next/standalone", `${root}/app`, { recursive: true, dereference: true });
await cp(".next/static", `${root}/app/.next/static`, { recursive: true });
await cp("public", `${root}/app/public`, { recursive: true });
await readFile(`${root}/app/server.js`); // Fail if tracing emitted an unexpected layout.
async function assertPortable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, `Non-portable release link: ${directory}/${entry.name}`);
    if (entry.isDirectory()) await assertPortable(`${directory}/${entry.name}`);
  }
}
await assertPortable(`${root}/app`);

const port = "3187";
// Test outside the checkout: Node must not resolve missing dependencies from
// the build's node_modules or follow aliases back into the build directory.
const isolated = await mkdtemp(`${tmpdir()}/youanalyst-release-`);
await cp(`${root}/app`, isolated, { recursive: true, verbatimSymlinks: true });
// A read-only fixture exists only in the temporary test copy, never the artifact.
// Exercise the compiled page: Next may encode page params differently from metadata.
const fixture = `${isolated}/company-fixture.cjs`;
await writeFile(fixture, `
const company = { market: 'CN_A', status: 'PUBLISHED', name: '海光信息',
  stage: '算力芯片', description: 'Fixture company overview',
  source: 'https://example.com/report', sourceLabel: 'Fixture report' };
globalThis.__adminApp = { firestore: () => ({ collection: name => {
  if (name !== 'market_companies') throw new Error('Unexpected fixture collection');
  return { doc: id => ({ get: async () => ({ id, exists: id === 'XSHG:688041', data: () => company }) }) };
} }) };
`);
const server = spawn(process.execPath, ["--require", fixture, "server.js"], {
  cwd: isolated,
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: port },
  stdio: "ignore",
});
const base = `http://127.0.0.1:${port}`;
try {
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(server.exitCode, null, "Standalone server exited before becoming ready");
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { health = await response.json(); break; }
    } catch { /* Allow the server time to start. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.equal(health?.status, "ok", "Standalone health check failed");
  assert.equal(health.commitSha, process.env.GIT_SHA);
  assert.equal(health.environment, process.env.APP_ENVIRONMENT);
  const chunks = await readdir(`${root}/app/.next/static/chunks`);
  const asset = chunks.find((name) => name.endsWith(".js"));
  assert.ok(asset, "Missing browser JavaScript");
  const assetResponse = await fetch(`${base}/_next/static/chunks/${asset}`);
  assert.equal(assetResponse.status, 200);
  assert.ok((await assetResponse.text()).length > 0);
  const privateResponse = await fetch(`${base}/api/watchlists/default`, { method: "POST" });
  assert.equal(privateResponse.status, 401, "Private API must still require authentication");
  for (const symbol of ["XSHG:688041", "XSHG%3A688041", "688041"]) {
    // Node fetch does not retain the language cookie across the numeric redirect.
    const response = await fetch(`${base}/ticker/${symbol}?lang=zh-CN`, {
      headers: { cookie: "ya-language=zh-CN" },
    });
    assert.equal(response.status, 200, `A-share company route failed: ${symbol}`);
    const html = await response.text();
    assert.match(html, /<h1[^>]*>海光信息<\/h1>/);
    assert.match(html, /公司概览/);
    assert.match(html, /Fixture report/);
  }
  const missing = await fetch(`${base}/ticker/XSHG:688042`);
  assert.equal(missing.status, 404, "Unknown company must remain a 404");
} finally {
  server.kill("SIGTERM");
}
await writeFile(`${root}/manifest.json`, JSON.stringify({
  commit: process.env.GIT_SHA,
  environment: process.env.APP_ENVIRONMENT,
  node: process.versions.node,
  checked: true,
}));
console.log("Standalone release passed health, assets, authentication and A-share route checks.");
