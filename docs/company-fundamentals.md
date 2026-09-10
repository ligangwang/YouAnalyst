# SEC company fundamentals

Company pages stream a Business and financials section independently of metadata and the existing research panels. No paid fundamentals API or AI generation is called.

Data comes from SEC ticker identities, submissions and Company Facts. The latest original 10-K, 20-F or 40-F anchors the annual reporting date. Standard US-GAAP and selected IFRS tags supply revenue, net income, diluted EPS, operating cash flow, cash and equivalents, and total assets. Annual flows require a 350–380-day duration; cash and assets require instant facts. Quarterly, YTD, mismatched-issuer and ambiguous currency/value records are excluded. Each populated card links to its own source filing, including a later restatement for the same period. Values are reported currency, not converted USD or ADR-adjusted EPS.

For 10-K filers, an opening business paragraph is selected from Item 1, using the existing section cache when available. This is a labeled, possibly shortened quotation, not a generated summary. If extraction is unavailable, the annual report link remains. Foreign annual-report narrative extraction and nonstandard transition years are not supported in this version.

Compact results live in server-owned `company_fundamentals/{ticker}` documents. Visits recheck after 24 hours; this is demand-driven, not a scheduled refresh. Per-company 90-second leases and in-process deduplication reduce repeat work. Failed requests retain the previous dated snapshot and retry on visits after one hour. Snapshots older than two days display a refresh notice. Unsupported companies cache an unavailable result for 24 hours. SEC calls use the existing SEC_USER_AGENT setting and bounded timeouts; no API key is needed.

Validation includes annual versus quarter/YTD separation, restatements and source provenance, missing/zero/negative values, ambiguous records, currency units, issuer identity, safe filing paths, narrative boilerplate, and desktop/mobile presentation. AMD's public 2025 annual data and Item 1 were also checked during implementation.

Reference: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
