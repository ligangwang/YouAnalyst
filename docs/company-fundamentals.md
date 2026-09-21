# SEC company fundamentals

Company pages stream a Business and financials section independently of metadata and the existing research panels. No paid fundamentals API or AI generation is called.

Data comes from SEC ticker identities, submissions and Company Facts. The latest original 10-K, 20-F or 40-F anchors the annual reporting date. Standard US-GAAP and selected IFRS tags supply revenue, net income, diluted EPS, operating cash flow, cash and equivalents, and total assets. Annual flows require a 350–380-day duration; cash and assets require instant facts. Quarterly, YTD, mismatched-issuer and ambiguous currency/value records are excluded. Each populated card links to its own source filing, including a later restatement for the same period. Values are reported currency, not converted USD or ADR-adjusted EPS.

For 10-K filers, an opening business paragraph is selected from Item 1, using the existing section cache when available. This is a labeled, possibly shortened quotation, not a generated summary. If extraction is unavailable, the annual report link remains. Foreign annual-report narrative extraction and nonstandard transition years are not supported in this version.

Compact results and durable request state live together in server-owned `company_fundamentals/{ticker}` documents. Visits only read the cache and idempotently queue missing or expired data; they never contact SEC. The `refresh-sec-fundamentals-production` Cloud Run Job runs daily at 21:00 America/New_York through Cloud Scheduler. Each run queues missing/expired US industry-map companies using the same full graph as the website, audits cache/request coverage, then drains visitor and map requests sequentially. Cached financials, pending requests and explicit unavailable results are counted separately.

A shared worker lease prevents overlapping executions; per-company 90-second leases also protect refreshes. All fundamentals SEC requests are spaced by at least 500 ms. Successful snapshots become eligible after 23 hours so daily-run timing variation does not skip updates. Failures preserve prior data and pending requests, record sanitized errors, and retry on a subsequent scheduled run after a one-hour cooldown. HTTP 403/429 stops the batch. Unsupported companies retain request history and an unavailable reason with a seven-day retry interval. Snapshots older than two days display a refresh notice. SEC calls use the existing SEC_USER_AGENT setting and bounded timeouts; no API key is needed. See DEPLOYMENT.md for provisioning, limits and coverage logs.

Validation includes annual versus quarter/YTD separation, restatements and source provenance, missing/zero/negative values, ambiguous records, currency units, issuer identity, safe filing paths, narrative boilerplate, and desktop/mobile presentation. AMD's public 2025 annual data and Item 1 were also checked during implementation.

Reference: https://www.sec.gov/search-filings/edgar-application-programming-interfaces

SEC failures are logged at the shared request boundary, before an optional caller can recover from them. HTTP errors (including 403/429), network failures, timeouts, cancellation, JSON decoding and filing-body read failures emit one structured `sec_request_failed` event per failed request to Cloud Logging. Events include a unique request ID, endpoint path, status, failure kind, duration, retry-after and provider request ID when available, CIK/company/filing context, revision and Cloud Run execution/attempt. Fundamentals batch events additionally share the company and run ID with the maintenance logs. Requests have a 12-second timeout; existing queue cooldowns and retries remain in force. Headers, credentials, query strings and response bodies are not recorded. Successful requests do not emit error events.

In Google Cloud Logs Explorer, select project `ifindata-80905` and use:

```text
(resource.type="cloud_run_revision" OR resource.type="cloud_run_job")
jsonPayload.event="sec_request_failed"
```

Filter further with `jsonPayload.status=429`, `jsonPayload.ticker="AMD"`, `jsonPayload.cik="0000002488"`, `jsonPayload.kind="timeout"` or a `jsonPayload.runId` from the failed job. Request failures remain in Cloud Logging even when a later retry clears the company's latest error in Firestore. Retention follows the project's log bucket policy.
