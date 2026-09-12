import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
await cp(".next/standalone", `${root}/app`, { recursive: true });
await cp(".next/static", `${root}/app/.next/static`, { recursive: true });
await cp("public", `${root}/app/public`, { recursive: true });
await readFile(`${root}/app/server.js`); // Fail if tracing emitted an unexpected layout.

const port = "3187";
const server = spawn(process.execPath, ["server.js"], {
  cwd: `${root}/app`,
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
} finally {
  server.kill("SIGTERM");
}
await writeFile(`${root}/manifest.json`, JSON.stringify({
  commit: process.env.GIT_SHA,
  environment: process.env.APP_ENVIRONMENT,
  node: process.versions.node,
  checked: true,
}));
console.log("Standalone release passed health, static asset, and authentication checks.");
