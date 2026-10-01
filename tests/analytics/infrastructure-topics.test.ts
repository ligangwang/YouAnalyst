/* eslint-disable react/no-children-prop -- Typed provider props require children in these server-render-only trees. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { infrastructureTopics, RESEARCH_REVIEWED, topicSources } from "../../src/lib/research/infrastructure-topics";
import { researchChangeSummary } from "../../src/lib/knowledge-graph/change-summary";
import type { CompanyUpdate } from "../../src/lib/knowledge-graph/company-updates";

const require = createRequire(import.meta.url);
function components() {
  const previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  try {
    return {
      ...require("../../src/components/infrastructure-research-page") as typeof import("../../src/components/infrastructure-research-page"),
      ...require("../../src/components/providers/auth-provider") as typeof import("../../src/components/providers/auth-provider"),
      ...require("../../src/components/providers/locale-provider") as typeof import("../../src/components/providers/locale-provider"),
      ...require("../../src/components/research-change-summary") as typeof import("../../src/components/research-change-summary"),
    };
  } finally {
    if (previous) require.extensions[".css"] = previous; else delete require.extensions[".css"];
  }
}

test("new research questions retain dated primary sources, limits and next steps", () => {
  assert.deepEqual(infrastructureTopics.map(topic => topic.slug), ["ai-infrastructure-bottlenecks", "hbm-supply"]);
  const hosts = new Set(["investors.vertiv.com", "www.se.com", "investors.micron.com", "news.samsung.com", "nvidianews.nvidia.com", "www.sec.gov"]);
  for (const source of Object.values(topicSources)) {
    assert.equal(new URL(source.url).protocol, "https:");
    assert(hosts.has(new URL(source.url).hostname));
    assert(source.published < RESEARCH_REVIEWED);
  }
  for (const topic of infrastructureTopics) {
    assert.equal(new Set(topic.evidence.map(row => row.id)).size, topic.evidence.length);
    assert.equal(topic.steps.length, 3);
    for (const row of topic.evidence) {
      assert(topicSources[row.source]);
      for (const lang of ["en", "zh"] as const) assert(row.finding[lang] && row.limit[lang] && row.next[lang]);
    }
  }
  const hbm = infrastructureTopics[1];
  assert.match(hbm.evidence.find(row => row.id === "samsung-hbm4e")!.status.en, /Sample shipments/);
  assert.match(hbm.evidence.find(row => row.id === "micron-hbm4")!.status.en, /Volume shipments/);
  assert.match(infrastructureTopics[0].evidence.find(row => row.id === "vertiv-cooling")!.limit.en, /not installed customer capacity/);
});

test("both topic pages server-render sources, conceptual visuals, caveats and localized next steps", () => {
  const { InfrastructureResearchPage, AuthProvider, LocaleProvider } = components();
  for (const topic of infrastructureTopics) for (const chinese of [false, true]) {
    const html = renderToStaticMarkup(createElement(AuthProvider, { children: createElement(LocaleProvider, {
      locale: chinese ? "zh-CN" : "en", children: createElement(InfrastructureResearchPage, { topic, chinese }),
    }) }));
    assert(html.includes(topic.title[chinese ? "zh" : "en"]));
    assert(html.includes(`dateTime="${RESEARCH_REVIEWED}"`));
    assert(html.includes(chinese ? "证据边界" : "Evidence limit"));
    assert(html.includes(chinese ? "/zh-cn/feed?scope=following" : "/en/feed?scope=following"));
    for (const row of topic.evidence) assert(html.includes(topicSources[row.source].url));
    assert.doesNotMatch(html, /Not yet in the company directory/);
  }
});

const update = (id: string, kind: "BUSINESS" | "RESEARCH", eventDate: string | null, sourceDate: string | null, collectedAt: string): CompanyUpdate => ({ id, kind, companyIds: ["US:AMD"], eventDate, sourceDate, collectedAt, sourceUrl: "https://example.com/source", sourceTitle: "Source", description: "Source description", href: "/en/ticker/AMD" });

test("research summary prefers business reports and never treats collection as a newly dated event", () => {
  const old = update("old", "BUSINESS", "2024-01-01", "2024-01-02", "2026-10-01");
  const report = update("report", "BUSINESS", null, "2026-08-11", "2026-09-16");
  const review = update("review", "RESEARCH", null, "2026-09-29", "2026-10-01");
  assert.deepEqual(researchChangeSummary([old, review, report]).map(item => item.id), ["report", "old"]);
  assert.deepEqual(researchChangeSummary([review, review]).map(item => item.id), ["review"]);
  assert.deepEqual(researchChangeSummary([old], 0), []);
  assert.equal(report.eventDate, null);
});

test("summary labels undated reports and evidence reviews honestly in both languages", () => {
  const { ResearchChangeSummary, LocaleProvider } = components();
  const graph = { asOf: RESEARCH_REVIEWED, nodes: [], relationships: [], sources: [] };
  const item = update("report", "BUSINESS", null, "2026-08-11", "2026-09-16");
  for (const locale of ["en", "zh-CN"] as const) {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(ResearchChangeSummary, { graph, items: [item], following: true }) }));
    assert(html.includes(locale === "en" ? "Source published" : "资料发布日期"));
    assert(html.includes(locale === "en" ? "Event timing is not stated" : "事件发生日期未明确"));
    assert(html.includes(locale === "en" ? "no prior-state comparison" : "未记录可用于前后对比"));
    assert(html.includes('dateTime="2026-08-11"'));
    assert(!html.includes('dateTime="2026-09-16"'));
  }
});
