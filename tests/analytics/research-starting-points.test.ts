import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { buildSync } from "esbuild";
import { researchStartingPoints } from "../../src/lib/research/starting-points";
import { researchConnections as amdConnections, selectedConnections as amdSelected } from "../../src/lib/research/amd-ecosystem";
import { researchConnections as nvidiaConnections, selectedConnections as nvidiaSelected } from "../../src/lib/research/nvidia-ecosystem";
import { isLocalizedPage, localizedPath } from "../../src/lib/i18n/urls";
import { topicSources } from "../../src/lib/research/infrastructure-topics";

test("homepage questions preserve localized, focused research destinations", () => {
  assert.deepEqual(researchStartingPoints.map(entry => entry.id), ["nvidia-suppliers", "amd-live-deployments", "ai-infrastructure-bottlenecks"]);
  for (const entry of researchStartingPoints) {
    const url = new URL(entry.href, "https://youanalyst.com");
    assert(isLocalizedPage(url.pathname));
    assert.equal(localizedPath(entry.href, "zh-CN"), `/zh-cn${entry.href}`);
    assert(entry.question.en && entry.question.zh && entry.shortLabel.en && entry.shortLabel.zh && entry.summary.en && entry.summary.zh);
    assert(entry.sources.length > 0);
  }
  const suppliers = new URL(researchStartingPoints[0].href, "https://youanalyst.com");
  assert.equal(suppliers.hash, "#connections");
  const supplierRows = nvidiaSelected("all", suppliers.searchParams.get("relation")!);
  assert(supplierRows.length > 0 && supplierRows.every(row => row.kind === "supplier"));
  const deployments = new URL(researchStartingPoints[1].href, "https://youanalyst.com");
  const deploymentRows = amdSelected(deployments.searchParams.get("product")!, deployments.searchParams.get("relation")!);
  assert(deploymentRows.some(row => `#${row.symbol}` === deployments.hash));
  assert(deploymentRows.every(row => row.kind !== "planned"));
});

test("homepage citations reuse dated primary evidence and preserve CPU and shortage limits", () => {
  const evidence = [...amdConnections, ...nvidiaConnections];
  for (const entry of researchStartingPoints.slice(0, 2)) {
    for (const source of entry.sources) {
      assert.equal(new URL(source.url).protocol, "https:");
      assert(evidence.some(row => row.url === source.url && row.date === source.date));
      assert(source.label.en && source.label.zh);
    }
  }
  assert.match(researchStartingPoints[1].summary.en, /does not establish Instinct GPU deployments/);
  assert.match(researchStartingPoints[1].summary.zh, /不能证明 Instinct GPU 已部署/);
  assert.match(researchStartingPoints[2].summary.en, /does not establish|do not establish/);
  assert(researchStartingPoints[2].sources.some(source => source.url === topicSources.vertivBlueprint.url && source.date === topicSources.vertivBlueprint.published));
  assert(researchStartingPoints[2].sources.some(source => nvidiaConnections.some(row => row.id === "mu-hbm4" && row.url === source.url && row.date === source.date)));
});

test("homepage cards render crawlable, localized questions and primary sources without a browser", () => {
  const result = buildSync({
    stdin: { contents: `import React from "react";
      import {renderToStaticMarkup} from "react-dom/server";
      import {LocaleProvider} from "./src/components/providers/locale-provider";
      import {ResearchStartingPoints} from "./src/components/research-starting-points";
      import {researchStartingPoints} from "./src/lib/research/starting-points";
      export const render = locale => renderToStaticMarkup(<LocaleProvider locale={locale}><ResearchStartingPoints entries={researchStartingPoints}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", outfile: "homepage-ssr.cjs",
    external: ["react", "react-dom/server", "react/jsx-runtime"],
    alias: { "next/link": path.resolve("tests/industry/link.tsx") },
  });
  const compiled = { exports: {} as { render(locale: string): string } };
  new Function("require", "module", "exports", result.outputFiles.find(file => file.path.endsWith(".cjs"))!.text)(createRequire(import.meta.url), compiled, compiled.exports);
  for (const locale of ["en", "zh-CN"]) {
    const html = compiled.exports.render(locale);
    const prefix = locale === "en" ? "/en" : "/zh-cn";
    assert.equal((html.match(/<article/g) ?? []).length, 3);
    assert.equal((html.match(/<h2/g) ?? []).length, 3);
    assert(html.includes(`href="${prefix}/research/ai-infrastructure-bottlenecks"`));
    assert(html.includes(`href="${prefix}/research/amd-ai-ecosystem?product=EPYC&amp;relation=integration#AMZN"`));
    assert(html.includes(locale === "en" ? "Who supplies NVIDIA?" : "谁在为英伟达供货？"));
    for (const entry of researchStartingPoints) for (const source of entry.sources) {
      assert(html.includes(`href="${source.url}"`));
      if (source.date) assert(html.includes(`dateTime="${source.date}"`));
    }
  }
});


test("homepage intro is compact, bilingual and links to the same focused research", () => {
  const result = buildSync({
    stdin: { contents: `import React from "react";
      import {renderToStaticMarkup} from "react-dom/server";
      import {LocaleProvider} from "./src/components/providers/locale-provider";
      import {ResearchQuickLinks} from "./src/components/research-starting-points";
      import {researchStartingPoints} from "./src/lib/research/starting-points";
      export const render = locale => renderToStaticMarkup(<LocaleProvider locale={locale}><ResearchQuickLinks entries={researchStartingPoints}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", outfile: "homepage-intro-ssr.cjs",
    external: ["react", "react-dom/server", "react/jsx-runtime"],
    alias: { "next/link": path.resolve("tests/industry/link.tsx") },
  });
  const compiled = { exports: {} as { render(locale: string): string } };
  new Function("require", "module", "exports", result.outputFiles.find(file => file.path.endsWith(".cjs"))!.text)(createRequire(import.meta.url), compiled, compiled.exports);
  for (const locale of ["en", "zh-CN"]) {
    const html = compiled.exports.render(locale);
    const language = locale === "en" ? "en" : "zh";
    assert.equal((html.match(/<a /g) ?? []).length, 3);
    assert.equal((html.match(/<p /g) ?? []).length, 1);
    assert(!html.includes("<article") && !html.includes("<h2") && !html.includes("<time"));
    for (const entry of researchStartingPoints) {
      assert(html.includes(entry.shortLabel[language]));
      assert(html.includes(localizedPath(entry.href, locale === "en" ? "en" : "zh-CN").replaceAll("&", "&amp;")));
      assert(!html.includes(entry.summary[language]));
      for (const source of entry.sources) assert(!html.includes(source.url));
    }
  }
});
