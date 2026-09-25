import test from "node:test";
import assert from "node:assert/strict";
import { checkPrivateValuation, discoverFundingLinks, fetchPrivateSource, plainSource, privateValuationFresh, privateValuationSources } from "../../src/lib/fundamentals/private-valuations";

const now = Date.parse("2026-09-25T12:00:00Z");
const source = privateValuationSources["ORG:ANTHROPIC"];
const index = `<a href="/news/product-update">Product update</a>`;
test("verified round retains original date and stale age does not reset on recheck", async () => {
  const get = async (url: string) => url === source.newsUrl ? index : `<p>${source.evidence}</p>`;
  const result = await checkPrivateValuation("ORG:ANTHROPIC", now, get);
  assert.equal(result.status, "verified");
  assert.equal(result.valuation?.valuationDate, "2026-05-28");
  assert.equal((await checkPrivateValuation("ORG:ANTHROPIC", now + 366 * 86400000, get)).status, "stale");
  assert.equal(privateValuationFresh({ ...source.valuation, valuationDate: "2027-01-01" }, now), false);
});
test("source edits and unknown companies require review instead of fabricated values", async () => {
  const result = await checkPrivateValuation("ORG:ANTHROPIC", now, async url => url === source.newsUrl ? index : source.evidence.replace("965", "999"));
  assert.equal(result.status, "review_required"); assert.equal(result.valuation, undefined);
  assert.equal((await checkPrivateValuation("ORG:UNKNOWN", now)).status, "unsupported");
});
test("news discovery only returns same-origin funding links, ignoring evaluation and grants", () => {
  const html = `<a href="/news/series-i">Series I funding</a><a href="https://evil.test/news/raises">Raises</a><a href="/news/embedded-evaluation">Evaluation</a><a href="/news/grants">Research funding</a><a href="/news/series-h">Raises</a>`;
  assert.deepEqual(discoverFundingLinks(html, source.newsUrl, source.valuation.sourceUrl), ["https://www.anthropic.com/news/series-i"]);
});
test("RSS discovery filters old rounds and new proposals remain review candidates", () => {
  const rss = `<rss><item><title><![CDATA[New funding round]]></title><link>https://openai.com/index/new-round</link><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate></item><item><title>Old funding round</title><link>https://openai.com/index/old-round</link><pubDate>Sun, 01 Mar 2026 12:00:00 GMT</pubDate></item></rss>`;
  assert.deepEqual(discoverFundingLinks(rss, "https://openai.com/news/rss.xml", "https://openai.com/index/known", "2026-03-31"), ["https://openai.com/index/new-round"]);
});
test("RSS detects financing in descriptions even when the headline is generic", () => {
  const rss = `<rss><item><title><![CDATA[Our next phase]]></title><description><![CDATA[We closed a new funding round.]]></description><link>https://openai.com/index/next-phase</link><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate></item></rss>`;
  assert.deepEqual(discoverFundingLinks(rss, "https://openai.com/news/rss.xml", "https://openai.com/index/known", "2026-03-31"), ["https://openai.com/index/next-phase"]);
});
test("blocked articles do not become verified just because RSS is accessible", async () => {
  const result = await checkPrivateValuation("ORG:OPENAI", now, async url => {
    if (url.endsWith("rss.xml")) return "<rss><item><title>Product</title></item></rss>";
    throw Error("403");
  });
  assert.equal(result.status, "review_required"); assert.equal(result.valuation, undefined);
  await assert.rejects(checkPrivateValuation("ORG:ANTHROPIC", now, async () => "<html>Challenge</html>"), /no readable announcement/);
});
test("Mistral keeps its EUR lower bound; scripts are not evidence", async () => {
  const mistral = privateValuationSources["ORG:MISTRAL-AI"];
  const result = await checkPrivateValuation("ORG:MISTRAL-AI", now, async url => url === mistral.newsUrl ? index : `<p>${mistral.evidence.replace("€", "&euro;")}</p>`);
  assert.equal(result.valuation?.currency, "EUR"); assert.equal(result.valuation?.qualifier, "greater_than");
  assert.equal(plainSource("<script>965 billion</script><p>hello</p>"), "hello");
});
test("source fetch rejects off-origin URLs before making requests", async () => {
  await assert.rejects(fetchPrivateSource("https://evil.test/news", "https://openai.com"), /Untrusted/);
  await assert.rejects(fetchPrivateSource("https://user@openai.com/news", "https://openai.com"), /Untrusted/);
});
