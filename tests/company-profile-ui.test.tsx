import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeChinaCompany } from "../src/lib/industry-research/china";
import { buildCompanyResearch } from "../src/lib/company-research";
import type { CompanyProfile } from "../src/lib/company-profile";

const require = createRequire(import.meta.url);
const { CompanyProfileDetails } = require("../src/components/company-profile-details") as typeof import("../src/components/company-profile-details");
const { LocaleProvider } = require("../src/components/providers/locale-provider") as typeof import("../src/components/providers/locale-provider");
const profile: CompanyProfile = { checkedAt: "2026-09-13", financialReportStatus: "AVAILABLE", financialReport: { title: "2026 interim report", url: "https://example.com/report.pdf", form: "INTERIM", periodEnd: "2026-06-30", publishedAt: "2026-08-20" } };
test("English and Chinese render crawlable report links and distinguish reporting and publication dates", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const html = renderToStaticMarkup(<LocaleProvider locale={locale}><CompanyProfileDetails profile={profile} /></LocaleProvider>);
    assert(html.includes(locale === "en" ? "Latest financial report" : "最新财务报告"));
    assert(html.includes(locale === "en" ? "Period ended" : "报告期末"));
    assert(html.includes(locale === "en" ? "Published" : "披露日期"));
    assert(html.includes('href="https://example.com/report.pdf"'));
    assert(html.includes("2026-06-30") && html.includes("2026-08-20"));
  }
  assert.equal(renderToStaticMarkup(<CompanyProfileDetails profile={null} />), "");
});
test("both listing and A-share projections preserve reviewed profile metadata", () => {
  assert(buildCompanyResearch("AMD", [{ symbol: "AMD", active: true, predictionSupported: true, profile }], null).profile?.financialReport);
  assert(normalizeChinaCompany({ id: "XSHG:600584", name: "长电科技", stage: "封装", description: "公司介绍", source: "https://example.com", sourceLabel: "来源", profile })?.profile?.financialReport);
  const research = normalizeChinaCompany({ id: "XSHG:600584", name: "长电科技", stage: "封装", description: "Updated description", source: "https://example.com", sourceLabel: "来源" });
  assert(research);
  assert.equal(Object.hasOwn(research, "profile"), false);
  assert.deepEqual({ profile, ...research }.profile, profile);
});
