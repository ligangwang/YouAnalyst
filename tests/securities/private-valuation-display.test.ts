import test from "node:test";
import assert from "node:assert/strict";
import { checkPrivateValuation, privateValuationSources } from "../../src/lib/fundamentals/private-valuations";
import { projectPrivateValuation } from "../../src/lib/knowledge-graph/private-valuation";
import { graphFromMarket } from "../../src/lib/knowledge-graph/market-store";

const now = Date.parse("2026-09-25T12:00:00Z");
const id = "ORG:OPENAI", valuation = privateValuationSources[id].valuation;
const feed = `<rss><item><link>${valuation.sourceUrl}</link><pubDate>Tue, 31 Mar 2026 13:00:00 GMT</pubDate></item></rss>`;
test("matching official RSS permits a clearly labelled reviewed fallback through the graph projection", async () => {
  const result = await checkPrivateValuation(id, now, async url => { if (url.endsWith("rss.xml")) return feed; throw Error("403"); });
  assert.equal(result.verification, "reviewed");
  assert.equal(result.status, "review_required");
  const projected = projectPrivateValuation(id, "PRIVATE", result, now);
  assert.equal(projected?.value, 852e9); assert.equal(projected?.verification, "reviewed");
  assert.equal(projected?.valuationDate, "2026-03-31");
  assert.equal(projectPrivateValuation(id, "PRIVATE", result, Date.parse("2027-04-01")), undefined);
});
test("fallback requires both matching link and date; changed readable articles never use fallback", async () => {
  for (const wrong of [feed.replace("31 Mar", "30 Mar"), feed.replace("accelerating-the-next-phase-ai", "unrelated")]) {
    const result = await checkPrivateValuation(id, now, async url => { if (url.endsWith("rss.xml")) return wrong; throw Error("403"); });
    assert.equal(result.valuation, undefined);
  }
  const changed = await checkPrivateValuation(id, now, async url => url.endsWith("rss.xml") ? feed : "The valuation changed.");
  assert.equal(changed.valuation, undefined);
});
test("projection excludes stale, altered, unknown, public and unverified records", () => {
  const good = { status: "verified", checkedAt: new Date(now).toISOString(), valuation };
  assert.equal(projectPrivateValuation(id, "PRIVATE", good, now)?.value, 852e9);
  for (const bad of [{ ...good, status: "stale" }, { ...good, valuation: { ...valuation, value: 999e9 } }, { ...good, valuation: { ...valuation, sourceUrl: "javascript:alert(1)" } }, { ...good, status: "review_required" }, { ...good, checkedAt: "2027-01-01" }]) {
    assert.equal(projectPrivateValuation(id, "PRIVATE", bad, now), undefined);
  }
  assert.equal(projectPrivateValuation(id, "PUBLIC", good, now), undefined);
  assert.equal(projectPrivateValuation("ORG:UNKNOWN", "PRIVATE", good, now), undefined);
});
test("company master graph mapping includes saved private valuation and no market cap", (t) => {
  t.mock.method(Date, "now", () => now);
  const graph = graphFromMarket([{ id, name: "OpenAI", status: "PUBLISHED", listingStatus: "PRIVATE", privateValuationCheck: { status: "verified", checkedAt: new Date(now).toISOString(), valuation }, inGraph: { status: "PUBLISHED", stageIds: [], stages: [], memberships: [], sources: [], order: 0, asOf: "2026-09-25" } }], []);
  const company = graph.nodes.find(n => n.id === id)!;
  assert.equal(company.privateValuation?.value, 852e9); assert.equal(company.marketCap, undefined);
});
