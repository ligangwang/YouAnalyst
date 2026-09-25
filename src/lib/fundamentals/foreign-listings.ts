// Ratios describe ordinary shares represented by ONE US-traded unit, not the
// number of ADSs outstanding. Keep evidence with the issuer identity; ticker
// reuse must never silently inherit another issuer's ratio.
export type VerifiedForeignListing = {
  cik: number;
  ordinarySharesPerUnit: number;
  sourceUrl: string;
  verifiedOn: string;
};
export type ReviewedShareCount = { shares: number; date: string; filed: string; sourceUrl: string; tag: string };

// Point-in-time observations from disclosures that are absent from companyfacts.
// These are NOT perpetual overrides: the normal 180-day freshness check applies.
// Preserve the actual observation date, never the date this file was edited.
export const reviewedForeignShareCounts: Readonly<Record<string, ReviewedShareCount>> = {
  ASML: {shares:384_100_000,date:"2026-06-28",filed:"2026-07-15",tag:"reviewed:outstanding_shares_millions",
    sourceUrl:"https://www.sec.gov/Archives/edgar/data/937966/000162828026048235/statutoryinterimreport20.htm"},
  GFS: {shares:557_418_603,date:"2026-09-11",filed:"2026-09-15",tag:"reviewed:ordinary_shares_outstanding",
    sourceUrl:"https://www.sec.gov/Archives/edgar/data/1709048/000170904826000239/globalfoundriesincf-3asr.htm"},
  // A + B outstanding; treasury and non-outstanding C shares excluded.
  NBIS: {shares:238_400_165+33_455_053,date:"2026-06-30",filed:"2026-08-12",tag:"reviewed:class_a_plus_b_outstanding",
    sourceUrl:"https://www.sec.gov/Archives/edgar/data/1513845/000110465926094844/nbis-20260812xex99d2.htm"},
  TAL: {shares:135_728_324+49_153_604,date:"2026-04-30",filed:"2026-06-12",tag:"reviewed:class_a_plus_b_outstanding",
    sourceUrl:"https://www.sec.gov/Archives/edgar/data/1499620/000110465926073410/tal-20260228x20f.htm"},
  TSM: {shares:25_932_370_000,date:"2026-06-30",filed:"2026-08-14",tag:"reviewed:issued_paid_common_shares_thousands",
    sourceUrl:"https://www.sec.gov/Archives/edgar/data/1046179/000104617926000541/a2026q2consolidatedreport-.htm"},
  // Includes voting Class C ordinary shares; excludes treasury and reserved ADSs.
  VNET: {shares:1_677_368_135+30_721_723+60_000,date:"2026-03-31",filed:"2026-04-16",tag:"reviewed:class_a_plus_b_plus_c_outstanding",
    sourceUrl:"https://ir.vnet.com/static-files/66edba7b-c48d-44ff-8a3c-95bc94b6abe2"},
};

// Only use reviewed entity-wide outstanding concepts. Never sum arbitrary
// class facts, subtract treasury twice, or substitute EPS weighted averages.
export const foreignOutstandingTags: Readonly<Record<string, string[]>> = {
  ARM:["us-gaap:CommonStockSharesOutstanding"],
  ASML:["us-gaap:CommonStockSharesOutstanding"],
  // BABA's DEI cover value disagrees with its balance sheet by a factor of ten.
  BABA:["us-gaap:CommonStockSharesOutstanding"],
  GFS:["ifrs-full:NumberOfSharesOutstanding"],
  NBIS:["us-gaap:CommonStockSharesOutstanding"],
  TSM:["dei:EntityCommonStockSharesOutstanding"],
};
const listing = (cik: number, ordinarySharesPerUnit: number, sourceUrl: string): VerifiedForeignListing =>
  ({ cik, ordinarySharesPerUnit, sourceUrl, verifiedOn: "2026-09-25" });

export const verifiedForeignListings: Readonly<Record<string, VerifiedForeignListing>> = {
  ARM: listing(1973239, 1, "https://investors.arm.com/node/8281/html"),
  ASML: listing(937966, 1, "https://www.asml.com/en/investors/shares"),
  BABA: listing(1577552, 8, "https://www.sec.gov/Archives/edgar/data/1577552/000110465926099220/tm2623667d1_ex99-1.htm"),
  BIDU: listing(1329099, 8, "https://ir.baidu.com/news-releases/news-release-details/baidu-announces-second-quarter-2026-results"),
  GDS: listing(1526125, 8, "https://investors.gds-services.com/static-files/c25c5cde-248e-4e24-b0cb-b4c1865af4dc"),
  GFS: listing(1709048, 1, "https://www.sec.gov/Archives/edgar/data/1709048/000170904826000022/gfs-20251231.htm"),
  NBIS: listing(1513845, 1, "https://www.sec.gov/Archives/edgar/data/1513845/000110465926052948/nbis-20251231x20f.htm"),
  TAL: listing(1499620, 1 / 3, "https://filecache.investorroom.com/mr5irasia_100tal/204/download/Third%20Quarter%20Fiscal%20Year%202026%20Earnings%20Release.pdf"),
  TSM: listing(1046179, 5, "https://investor.tsmc.com/static/annualReports/2024/english/ebook/files/basic-html/page84.html"),
  VNET: listing(1508475, 6, "https://ir.vnet.com/news-releases/news-release-details/vnet-announces-us138-million-private-placement"),
};
