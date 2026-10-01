import assert from "node:assert/strict";
import test from "node:test";
import { localizeMetadata } from "../../src/lib/i18n/server";
import { buildDailyScoresMetadata } from "../../src/lib/daily-scores/page-metadata";

test("dated daily aliases share the localized canonical, hreflang and social URL", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const prefix = locale === "en" ? "/en" : "/zh-cn";
    for (const path of ["/daily", "/daily/2026-07-29", "/daily/calls", "/daily/calls/2026-07-29"]) {
      const result = localizeMetadata(buildDailyScoresMetadata("2026-07-29", true), locale, path, { usePageCanonical: true });
      assert.equal(result.alternates?.canonical, `${prefix}/daily/calls/2026-07-29`);
      assert.deepEqual(result.alternates?.languages, {
        en: "/en/daily/calls/2026-07-29",
        "zh-CN": "/zh-cn/daily/calls/2026-07-29",
        "x-default": "/en/daily/calls/2026-07-29",
      });
      assert.equal(result.openGraph?.url, result.alternates?.canonical);
    }
  }
});

test("latest daily canonical is stable as the latest available date changes", () => {
  for (const date of ["2026-09-29", "2026-09-30", null]) {
    const result = localizeMetadata(buildDailyScoresMetadata(date, false, null), "zh-CN", "/daily", { usePageCanonical: true });
    assert.equal(result.alternates?.canonical, "/zh-cn/daily/calls");
    assert.equal(result.alternates?.languages?.en, "/en/daily/calls");
  }
});

test("Chinese daily titles, snippets and social image labels are localized", () => {
  const result = localizeMetadata(buildDailyScoresMetadata("2026-07-29", true), "zh-CN", "/daily", { usePageCanonical: true });
  assert.equal(result.title, "今日最佳观点 - 2026-07-29 | YouAnalyst");
  assert.equal(result.description, "查看 YouAnalyst 今日热门公开股票观点及每日表现变化。");
  assert.equal(result.openGraph?.title, result.title);
  assert.equal(result.twitter?.description, result.description);
  assert.match(JSON.stringify(result.openGraph?.images), /每日热门观点分享卡片/);
  const fallback = localizeMetadata(buildDailyScoresMetadata(null, false), "zh-CN", "/daily", { usePageCanonical: true });
  assert.equal(fallback.title, "每日得分变化 | YouAnalyst");
  assert.equal(fallback.description, "跟踪 YouAnalyst 每日得分变化及分析师近期表现。");
});

test("layout and ordinary ticker metadata keep request-path canonicals by default", () => {
  const input = { title: "Company research", alternates: { canonical: "/" } };
  const result = localizeMetadata(input, "zh-CN", "/ticker/BWAY");
  assert.equal(result.alternates?.canonical, "/zh-cn/ticker/BWAY");
  assert.equal(result.alternates?.languages?.en, "/en/ticker/BWAY");
  assert.equal(input.alternates.canonical, "/");
  assert.deepEqual(localizeMetadata(input, "en", null), input);
});

test("a missing or external page canonical falls back to the request path", () => {
  for (const canonical of [undefined, "https://example.com/other", "//example.com/other"]) {
    const result = localizeMetadata({ alternates: { canonical } }, "en", "/daily/calls", { usePageCanonical: true });
    assert.equal(result.alternates?.canonical, "/en/daily/calls");
  }
});
