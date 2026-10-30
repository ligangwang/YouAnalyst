import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
// Exercise the native SQLite binding from the isolated Linux release itself.
const Sqlite = createRequire(`${isolated}/server.js`)('better-sqlite3');
const sqliteProbe = new Sqlite(':memory:');
try { assert.equal(sqliteProbe.prepare('SELECT 1 AS ready').get().ready, 1); }
finally { sqliteProbe.close(); }

// A read-only fixture exists only in the temporary test copy, never the artifact.
// Exercise the compiled page: Next may encode page params differently from metadata.
const fixture = `${isolated}/company-fixture.cjs`;
const themeNodes = JSON.parse(await readFile('data/investment-themes/catalog-v1.json', 'utf8')).nodes;
await writeFile(fixture, `
const themeNodes = ${JSON.stringify(themeNodes)};
const company = { market: 'CN_A', status: 'PUBLISHED', name: '海光信息', slug: 'hygon-information',
  stage: '算力芯片', description: 'Fixture company overview',
  source: 'https://example.com/report', sourceLabel: 'Fixture report' };
const companies={
 'XSHG:688041':company,
 'ORG:OPENAI':{ name: 'OpenAI', slug:'openai', status: 'DIRECTORY', country: 'US', listingStatus: 'PRIVATE', description: 'OpenAI profile fixture' },
 'ORG:GLOBAL-LAB':{ name: 'Global Lab', slug:'global-lab', status: 'DIRECTORY', country: 'FR', listingStatus: 'PRIVATE', description: 'Global profile fixture' }
};
const doc=id=>({id,exists:Boolean(companies[id]),data:()=>companies[id]});
globalThis.__adminApp = { firestore: () => ({ collection: name => {
  if (name === 'investment_themes') {
    const query = { where:()=>query, select:()=>query, limit:()=>query, get:async()=>({docs:themeNodes.map(node=>({id:node.id,data:()=>node}))}) };
    return query;
  }
  if (name !== 'companies') throw new Error('Unexpected fixture collection');
  return {doc:id=>({get:async()=>doc(id)}),where:(field,op,value)=>({limit:()=>({get:async()=>({docs:Object.keys(companies).filter(id=>op==='array-contains'?(companies[id][field]||[]).includes(value):companies[id][field]===value).map(doc)})})})};
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
  const catalogResponse = await fetch(`${base}/api/investment-themes`);
  assert.equal(catalogResponse.status, 200, 'Standalone must serve the Firestore theme catalog');
  const catalog = await catalogResponse.json();
  assert.equal(catalog.nodes.filter(node=>node.parentId===null).length, 4);
  assert.ok(['ai','robotics','space'].every(id=>catalog.nodes.some(node=>node.id===id)));
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
  for (const locale of ["en", "zh-cn"]) {
    const clean = await fetch(`${base}/${locale}/company/openai`);
    assert.equal(clean.status, 200);
    assert.match(await clean.text(), new RegExp(`rel="canonical"[^>]+href="[^"]+/${locale}/company/openai"`));
    for (const id of ["ORG:OPENAI", "ORG%3AOPENAI"]) {
      const redirect = await fetch(`${base}/${locale}/company/${id}?source=legacy&tag=a&tag=b`, { redirect: "manual" });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get("location"), `/${locale}/company/openai?source=legacy&tag=a&tag=b`);
    }
    for (const id of ["ORG:GLOBAL-LAB", "ORG%3AGLOBAL-LAB"]) {
      const response = await fetch(`${base}/${locale}/company/${id}`);
      assert.equal(response.status, 200, `Global profile failed: ${locale}/${id}`);
      const html = await response.text();
      const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
      assert.ok(heading, "Global profile must have a company heading");
      assert.equal(heading.replace(/<[^>]+>/g, ""), "Global Lab");
      assert.match(heading, new RegExp(String.raw`<img\b[^>]*src="/flags/fr\.svg(?:\?dpl=${process.env.GIT_SHA})?"[^>]*>`));
      assert.match(html, /Global profile fixture/);
      assert.match(html, locale === "en" ? /France · Private/ : /法国 · 非上市公司/);
    }
  }
  for (const id of ["ORG:UNKNOWN", "ORG%2FBAD"]) {
    const response = await fetch(`${base}/en/company/${id}`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /Company profile not available/);
  }
  const unavailable = await fetch(`${base}/en/company/openabc`);
  assert.equal(unavailable.status, 404);
  const unavailableHtml = await unavailable.text();
  assert.match(unavailableHtml, /Company profile not available/);
  assert.match(unavailableHtml, /openabc/);
  assert.match(unavailableHtml, /noindex/);
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
