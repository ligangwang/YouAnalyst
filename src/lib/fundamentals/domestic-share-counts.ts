import type { ReviewedShareCount } from "./foreign-listings";

// Reviewed common-equity issuers. Extra SEC symbols can denote preferred stock;
// never use those symbols or their share counts to value common equity.
export const reviewedDomesticIssuers: Readonly<Record<string, { cik: number; tags: string[]; count?: ReviewedShareCount }>> = {
  GOOGL: { cik:1652044, tags:["us-gaap:CommonStockSharesOutstanding"], count:{shares:12_230_000_000,date:"2026-07-15",filed:"2026-07-23",tag:"reviewed:class_a_b_c_outstanding_millions",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1652044/000165204426000071/goog-20260630.htm"} },
  CRWV: { cik:1769628, tags:[], count:{shares:458_871_690+92_664_912,date:"2026-07-31",filed:"2026-08-12",tag:"reviewed:class_a_b_c_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1769628/000176962826000366/crwv-20260630.htm"} },
  DDOG: { cik:1561550, tags:[], count:{shares:334_904_614+24_170_410,date:"2026-07-31",filed:"2026-08-06",tag:"reviewed:class_a_plus_b_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1561550/000162828026054458/ddog-20260630.htm"} },
  DELL: { cik:1571996, tags:["us-gaap:CommonStockSharesOutstanding"], count:{shares:635_812_750,date:"2026-09-01",filed:"2026-09-08",tag:"reviewed:class_a_b_c_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1571996/000157199626000046/dell-20260731.htm"} },
  DLR: { cik:1297996, tags:["dei:EntityCommonStockSharesOutstanding"], count:{shares:370_036_176,date:"2026-07-29",filed:"2026-07-31",tag:"reviewed:common_stock_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1297996/000110465926089296/dlr-20260630x10q.htm"} },
  HPE: { cik:1645590, tags:["dei:EntityCommonStockSharesOutstanding"] },
  META: { cik:1326801, tags:[], count:{shares:2_205_128_509+342_377_716,date:"2026-07-24",filed:"2026-07-30",tag:"reviewed:class_a_plus_b_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1326801/000162828026050705/meta-20260630.htm"} },
  ORCL: { cik:1341439, tags:["dei:EntityCommonStockSharesOutstanding"] },
  PLTR: { cik:1321655, tags:["us-gaap:CommonStockSharesOutstanding"], count:{shares:2_300_713_329+101_340_151+1_005_000,date:"2026-07-27",filed:"2026-08-04",tag:"reviewed:class_a_b_f_outstanding",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1321655/000132165526000041/pltr-20260630.htm"} },
  SMCI: { cik:1375365, tags:["dei:EntityCommonStockSharesOutstanding"] },
};
