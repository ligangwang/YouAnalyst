# SEC company fundamentals

Company pages stream a Business and financials section independently of metadata and the existing research panels. No paid fundamentals API or AI generation is called.

Data comes from SEC ticker identities, submissions and Company Facts. The latest original 10-K, 20-F or 40-F anchors the annual reporting date. Standard US-GAAP and selected IFRS tags supply revenue, net income, diluted EPS, operating cash flow, cash and equivalents, and total assets. Annual flows require a 350–380-day duration; cash and assets require instant facts. Quarterly, YTD, mismatched-issuer and ambiguous currency/value records are excluded. Each populated card links to its own source filing, including a later restatement for the same period. Values are reported currency, not converted USD or ADR-adjusted EPS.

For 10-K filers, an opening business paragraph is selected from Item 1, using the existing section cache when available. This is a labeled, possibly shortened quotation, not a generated summary. If extraction is unavailable, the annual report link remains. Foreign annual-report narrative extraction and nonstandard transition years are not supported in this version.

Compact results and durable request state live together in server-owned `company_fundamentals/{ticker}` documents. Visits read the cache and idempotently queue missing or expired data; after the response they dispatch pending work through Pub/Sub and never contact SEC directly. Cached HTML remains crawlable; a brief client poll can display a completed refresh without reloading. The `refresh-sec-fundamentals-production` Cloud Run Job runs daily at 21:00 America/New_York through Cloud Scheduler. Each run queues missing/expired US industry-map companies using the same full graph as the website, audits cache/request coverage, then drains visitor and map requests sequentially. Cached financials, pending requests and explicit unavailable results are counted separately.

A shared worker lease prevents overlapping executions; per-company 90-second leases also protect refreshes. All SEC requests (including graph filing downloads) share a Firestore gate, with 200 ms spacing after each completed request and a maximum of five requests per second across replicas and jobs. Successful snapshots become eligible after 23 hours so daily-run timing variation does not skip updates. Failures preserve prior data and pending requests, record sanitized errors, and retry on a subsequent scheduled run after a one-hour cooldown. HTTP 403/429 stops the batch. Unsupported companies retain request history and an unavailable reason with a seven-day retry interval. Snapshots older than two days display a refresh notice. SEC calls use the existing SEC_USER_AGENT setting and bounded timeouts; no API key is needed. See DEPLOYMENT.md for provisioning, limits and coverage logs.

Validation includes annual versus quarter/YTD separation, restatements and source provenance, missing/zero/negative values, ambiguous records, currency units, issuer identity, safe filing paths, narrative boilerplate, and desktop/mobile presentation. AMD's public 2025 annual data and Item 1 were also checked during implementation.

Reference: https://www.sec.gov/search-filings/edgar-application-programming-interfaces

SEC failures are logged at the shared request boundary, before an optional caller can recover from them. HTTP errors (including 403/429), network failures, timeouts, cancellation, JSON decoding and filing-body read failures emit one structured `sec_request_failed` event per failed request to Cloud Logging. Events include a unique request ID, endpoint path, status, failure kind, duration, retry-after and provider request ID when available, CIK/company/filing context, revision and Cloud Run execution/attempt. Fundamentals batch events additionally share the company and run ID with the maintenance logs. Requests have a 12-second timeout; existing queue cooldowns and retries remain in force. Headers, credentials, query strings and response bodies are not recorded. Successful requests do not emit error events.

In Google Cloud Logs Explorer, select project `ifindata-80905` and use:

```text
(resource.type="cloud_run_revision" OR resource.type="cloud_run_job")
jsonPayload.event="sec_request_failed"
```

Filter further with `jsonPayload.status=429`, `jsonPayload.ticker="AMD"`, `jsonPayload.cik="0000002488"`, `jsonPayload.kind="timeout"` or a `jsonPayload.runId` from the failed job. Request failures remain in Cloud Logging even when a later retry clears the company's latest error in Firestore. Retention follows the project's log bucket policy.

# A-share annual financials through AKShare

Admin → Scheduled jobs → **A-share financials and market caps** provides the existing Run now action and run/error history. It processes every Shanghai/Shenzhen A-share company selected from the published map on each run, automatically including newly added companies. Annual updated/skipped/failed/deferred counts appear alongside share-count and market-cap results. The existing weekday 09:30 America/New_York schedule is unchanged.

The existing China fundamentals worker fetches annual consolidated income statements through AKShare 1.18.97 (`stock_profit_sheet_by_yearly_em`, Eastmoney). Full IDs map to provider symbols, for example `XSHE:301308` to `SZ301308`. `OPERATE_INCOME` is annual revenue and `PARENT_NETPROFIT` is net income attributable to the parent; both are stored in CNY yuan. Interim reports, future disclosures, mismatched securities, unsupported currencies, missing values and ambiguous revisions are rejected. Zero and negative profits are valid.

The existing `company_fundamentals/{fullCompanyId}` document stores `cnAnnual` (report period, announcement/update dates, source link, fetch time and metrics) and `cnAnnualStatus` (last check, retry time and outcome). No collection is added. Fetch failures preserve the previously published financials. The API accepts full A-share IDs and reads this cache without provider calls or SEC queue writes. Both the map company card and company page display the reporting year, attributable-profit label and AKShare/Eastmoney attribution; a cache older than three days is marked stale.

Annual refresh gets at most six minutes of the existing eighteen-minute worker budget, with a sixty-second subprocess limit per company. Successful checks wait one day, failures six hours. Least recently checked companies run first so a later run resumes deferred work; three failures stop the annual batch. Failed or deferred annual work makes the execution non-zero, while the share-count and market-cap phase still runs. Dry runs print annual snapshots without writing them.

`Dockerfile.fundamentals` installs the pinned Python requirements in `/opt/akshare` and sets `AKSHARE_PYTHON`. For local use, install `scripts/akshare-requirements.txt` in a virtual environment and set `AKSHARE_PYTHON` to its Python executable. Deploy the updated maintenance image as well as the website, then execute the existing China job to populate the initial cache. Website deployment alone does not populate financials.

Live provider checks on 2026-09-27 returned Longsys (`301308`) FY2025 revenue CNY 22,766,169,990.55 and attributable profit CNY 1,423,298,162.88 (announced 2026-04-28), and SMIC (`688981`) FY2025 revenue CNY 67,323,192,000 and attributable profit CNY 5,040,734,000. These development checks did not write production data.

# A-share share counts and market caps

Phase 1 of A-share fundamentals adds official share counts and an estimated market cap for every Shanghai (`XSHG:`) and Shenzhen (`XSHE:`) company on the map (about 62). It mirrors the SEC design: `cnMapCompanies(graph)` selects companies from the same published graph the website renders, `refresh-cn-fundamentals-production` owns share counts, and market caps are recalculated from stored prices without provider calls. The CNI directory sync and the China EOD job do not collect share counts.

## Sources (verified 2026-09-24 from a US GitHub Actions runner)

| Data | Source | Status |
| --- | --- | --- |
| Share structure: total, A (tradable/restricted), B and H shares with the date the structure took effect | cninfo `data20/stockholderCapital/getStockStructure?scode=` (巨潮资讯, the CSRC-designated disclosure platform operated by SZSE's 深圳证券信息有限公司) | Reachable; parsed exactly for 600584, 688981, 000063, 300308, 601138 |
| Exchange cross-check, Shanghai | SSE `query.sse.com.cn/commonQuery.do` sqlId `COMMON_SSE_CP_GPJCTPZ_GPLB_GPGK_GBJG_C` (`TOTAL_DOMESTIC_VOL`, `A_UNLIMIT_VOL`, `A_LIMIT_VOL`, `TRADE_DATE`) | Reachable; matches cninfo within SSE's 0.01 万股 rounding |
| Exchange cross-check, Shenzhen | SZSE `www.szse.cn/api/report/ShowReport/data` CATALOGID 1110 | **Not reachable** from US networks (connection timeout). Best effort: if reachable from Cloud Run its counts must match cninfo, otherwise the run records `exchangeCheck.status="unreachable"` and uses cninfo alone |
| A+H / B listing identity | cninfo `data20/companyOverview/getCompanyIntroduction` (`ASECCODE`, `BSECCODE`, `HSECCODE`) | Reachable (e.g. SMIC 00981, ZTE 00763, 中际旭创 03308) |
| Share-changing announcements | cninfo `new/hisAnnouncement/query` (org IDs from `new/information/topSearch/query`) | Reachable |
| Bonus/conversion ratios and ex-dates | cninfo `data20/companyOverview/getCompanyHisDividend` (`F007V` plan, `F020D` ex-date) | Reachable |

The sandbox used for development blocks all Chinese hosts, so these checks ran through the read-only **Probe A-share share-count sources** workflow (`scripts/probe-cn-share-sources.ts`, no credentials, no Firestore). That Action is now retired; with repository dependencies installed, use `npx tsx scripts/probe-cn-share-sources.ts "301308,600519"` from a suitable network (no credentials or database writes). Cloud Run (`us-central1`) is also a US network; run the dry run below before the first real run to confirm reachability from there.

## Share counts

Counts are stored with `date` (the day the structure took effect, cninfo `VARYDATE`), `asOf` (the day the sources last confirmed it), `fetchedAt`, `sourceUrl`, `sourceType`, the change reason, the listing identity and the exchange cross-check. Values are exact shares (cninfo publishes 万股 to four decimals); every class must reconcile to the published total. Counts refresh when missing, when `asOf` is 7 or more days old, or when a share-changing event has taken effect but is not yet reflected.

For A+H (and A+B) companies, H and B shares are stored separately and the total covers every class: **market cap = A-share close × total issued shares**, the common Chinese-site definition, recorded as `method: "a_close_x_total_shares"`. A company with an H-share listing but no H-share count is unavailable (`h_share_count_unavailable`), never valued on A shares alone. CDR structures are unsupported.

## Corporate actions

Every run lists the company's last 45 days of cninfo announcements and classifies share-changing titles: bonus/conversion issues and distribution implementation notices, placements and new-share listings, buyback cancellations and other share changes (e.g. vested restricted shares). Distribution notices are resolved with the dividend history: cash-only payouts are ignored; bonus or conversion issues take effect on their ex-date. Like the US split rule, a company is unavailable (`corporate_action_after_share_count`) when an event took effect on or before the price date but the stored count may predate it. An event is settled when the stored structure took effect on or after its ex-date, or once the count has been re-verified after the event's window (5 days, 15 for unresolved distributions). The job re-verifies such counts daily until settled. If announcements cannot be checked for more than 3 days, valuations become unavailable (`corporate_action_check_unavailable`).

## Market cap

`calculateCnMarketCap` = latest stored China EOD close (CNY, `tickers.latestEodPrice`, written by the China EOD job) × total shares. The China EOD job now loads prices for every A-share map company as well as prediction tickers, as the US run does. The USD value uses the stored USD/CNY close (`eod_prices/FX_USD_CNY_{date}`, written by the US EOD job) on or before the price date, looking back at most 7 days, and records the rate and rate date. Without a rate the CNY value is still estimated and `usdReason` is `missing_fx_rate`; the map then keeps default sizing. Guards: no share count dated after the price, none confirmed more than 180 days ago, no calculation across a pending corporate action. A suspended stock keeps its last close with that close's date (`lastClose: true` when it is older than the newest map session).

## Storage and display

Data lives in the existing `company_fundamentals` collection, keyed by full ID (`company_fundamentals/XSHG:600584`). A-share documents use `market`, `cnShares`, `cnShareStatus`, `cnActions`, `cnActionStatus`, `cnOrgId`, per-company lease fields and `marketCap` (`currency: "CNY"` with `usd`). They never carry the SEC queue fields (`pending`, `version`, `value`), and the SEC job skips IDs containing `:`; US documents are unchanged. `company_fundamentals/_cn_worker` holds the shared lease, provider cooldowns and the last run summary. No new collection is created.

The knowledge-graph loader attaches A-share caps in USD (for sizing, alongside US companies) with the CNY value and rate date. Map labels, tooltips and cards show `¥… CNY (≈ $… USD) · As of …`. A-share company pages show the CNY value, the USD value with the USD/CNY rate and its date, the as-of date, and calculation details in English and Chinese.

## Operations

`refresh-cn-fundamentals-production` runs weekdays at 09:30 America/New_York, after the China EOD job (08:00). Each run: takes the shared lease; checks corporate actions for every map company; refreshes share counts only when due; recalculates every market cap. Companies are processed sequentially under 2-minute per-company leases, with at least 1 second between provider requests and 15-second timeouts. Only validated outcomes make a company unavailable: an H or B listing without that class's count, a confirmed exchange/issuer mismatch, or a CDR structure. Everything else is a retryable failure: HTTP, network or timeout errors, HTTP 200 responses with an error body, changed or unparseable schemas, structures whose classes do not reconcile, and a missing listing identity. A failure keeps the previously published share count **and market cap** untouched (counted as `marketCaps.kept`), records `cnShareStatus.outcome="retry"` with the error, and waits out a 6-hour retry cooldown. HTTP 403/429 sets a 6-hour provider cooldown, and hosts that time out or refuse connections are skipped for the rest of the run. Structured logs share `jsonPayload.runId`; request failures emit `jsonPayload.event="cn_request_failed"` without query strings or bodies. The execution exits non-zero when more than 2 companies hit provider failures (`CN_FAILURE_THRESHOLD`), when any valuation write fails, or when the batch cannot finish. Every failure is still logged at ERROR, and unavailable companies never fail the run.

### Dry run before the first real run

`--dry-run` makes the same provider requests and reads prices and FX, but writes nothing (no lease, no company documents) and prints one JSON line per company with the share counts and sources, price, FX, CNY and USD market caps and corporate-action events. `--companies=XSHG:688981,XSHE:000063` limits a dry run to a few companies.

```sh
gcloud run jobs execute refresh-cn-fundamentals-production --region us-central1 \
  --args=dist/refresh-cn-fundamentals.cjs,--dry-run --wait
```

Then filter Logs Explorer by the execution and `textPayload:"marketCapCny"` (or read the job's logs) and spot-check a few companies, e.g. SMIC total shares 8,562,264,585 including 6,014,488,603 H shares. Share counts written by an earlier real run are what a later dry run reports as stored; a first dry run shows freshly fetched counts in its output.
