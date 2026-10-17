import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { MetadataRoute } from "next";

async function loadSitemap(unavailable = false) {
  const fixtures = {
    predictions: [{ id: "published", visibility: "PUBLIC", status: "ACTIVE", ticker: "NVDA", createdAt: "2026-10-13" }, { id: "canceled", status: "CANCELED" }],
    users: [{ id: "public", settings: { isPublic: true } }, { id: "private", settings: { isPublic: false } }],
    watchlists: [{ id: "shared", userId: "public" }, { id: "hidden", userId: "private" }, { id: "archived", userId: "public", archivedAt: "2026-10-13" }],
  };
  const result = await build({
    entryPoints: ["src/app/sitemaps/pages/sitemap.ts"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "read-only-sitemap-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/firebase\/admin$/ }, () => ({ path: "fixture", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        const fixtures = ${JSON.stringify(fixtures)};
        export function getAdminFirestore() {
          if (${unavailable}) throw new Error('Unavailable');
          return { collection(name) {
            if (name === 'collectors') return { doc: () => ({ get: async () => ({ data: () => ({ enabled: true, versions: {} }) }) }) };
            if (!fixtures[name]) throw new Error('Unexpected collection: ' + name);
            return { where() { return this; }, orderBy() { return this; }, limit() { return this; },
              async get() { return { docs: fixtures[name].map(({id, ...data}) => ({id, data: () => data})) }; } };
          } };
        }
      ` }));
    } }],
  });
  const compiled = { exports: {} as { default: () => Promise<MetadataRoute.Sitemap> } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports.default();
}

function assertCanonicalPublicEntries(entries: MetadataRoute.Sitemap) {
  const paths = entries.map(entry => new URL(entry.url).pathname);
  assert.equal(new Set(paths).size, paths.length);
  for (const locale of ["en", "zh-cn"]) {
    assert.ok(paths.includes(`/${locale}/calendar`));
    assert.ok(paths.includes(`/${locale}/daily/calls`));
    assert.ok(!paths.includes(`/${locale}/daily`));
    assert.ok(!paths.includes(`/${locale}/watchlists`));
    assert.ok(!paths.includes(`/${locale}/map`));
  }
  assert.ok(paths.every(path => !/\/(company|ticker)\//.test(path)));
  for (const entry of entries) {
    assert.ok(entry.alternates?.languages?.en);
    assert.ok(entry.alternates?.languages?.["zh-CN"]);
    assert.equal(entry.alternates?.languages?.["x-default"], entry.alternates?.languages?.en);
  }
  return paths;
}

test("page sitemap excludes private/duplicate company routes while retaining public community content", async () => {
  const paths = assertCanonicalPublicEntries(await loadSitemap());
  assert.ok(paths.includes("/en/predictions/published"));
  assert.ok(paths.includes("/en/analysts/public/watchlists/shared"));
  assert.ok(paths.includes("/zh-cn/analysts/public"));
  assert.ok(paths.every(path => !/private|hidden|archived|canceled/.test(path)));
});

test("database failure still produces canonical bilingual static routes", async () => {
  const paths = assertCanonicalPublicEntries(await loadSitemap(true));
  assert.ok(paths.every(path => !/\/(analysts|predictions)\//.test(path)));
});
