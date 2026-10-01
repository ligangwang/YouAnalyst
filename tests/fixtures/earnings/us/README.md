# US-listed earnings pilot fixtures

Verified against official issuer/SEC sources on **2026-10-01**. Includes the latest two **disclosed quarterly** periods for NVIDIA, AMD, Microsoft, and Alibaba's US-listed ADR. A completed quarter whose results had not yet been disclosed is not selected. Annual and year-to-date columns are not substituted for quarterly results.

## Files and provenance

- `inventory.json` gives period coverage, publication dates, and verified primary release URLs
- Each company-period JSON contains `source`, optional `supporting_sources`, `expected` facts, and evidence locators
- Adjacent `.excerpt.html` files are **curated factual test excerpts**, with newly constructed markup and normalized table cells. They are **not original publisher HTML**, nor full releases. The fixture IDs/selectors belong to the curated fixture, not the source website
- Fetched raw issuer HTML, Alibaba PDFs, and NVIDIA SEC 10-Q HTML were verified locally. Their original-byte SHA-256 and byte counts are recorded; full raw documents are intentionally not committed
- Microsoft release and transcript pages were read successfully through `web.run`; direct downloads timed out or returned HTTP 403. Their raw-byte hashes are null. No raw-byte provenance is claimed for them
- No earnings narrative was invented. The HTML contains factual labels, numbers, and normalized metadata. `normalized_factual_row` is explicitly not a verbatim prose quotation

## Interpretation traps represented

1. Fiscal labels differ: NVIDIA FY2027 Q1/Q2, AMD FY2026 Q1/Q2, Microsoft FY2026 Q3/Q4, Alibaba FY2026 Q4/FY2027 Q1. Start-date derivations are explicit
2. All actual monetary amounts use native currency **millions**. Alibaba reports RMB (`CNY`); convenience USD conversions are separate metadata
3. NVIDIA reportable segments (`Compute & Networking`, `Graphics`) are separate from market-platform revenue. The market platform taxonomy changed in FY2027 Q1; Q2 additionally recasts a Q1 Hyperscale/ACIE customer allocation. Preserve source versions
4. AMD's Client and Gaming is a single reportable segment. Its two business subrows are not additional segments
5. Microsoft Cloud overlaps Microsoft's three reportable segments. Reported and constant-currency growth are different fields
6. Microsoft's quantitative guidance is in the **official same-date call transcript**, not the release itself. Guidance currency/basis is not relabelled as GAAP when unspecified
7. Alibaba's June 2026 segment taxonomy differs from March. Segment totals require unallocated amounts and inter-segment eliminations
8. Alibaba's reviewed releases contain qualitative outlook but no numerical forward-revenue range. This is a release-scoped absence; the Alibaba call transcripts were not reviewed
9. NVIDIA's Q2 source shows six-month revenue of USD177,837 million, while the separately reported Q1 and Q2 values sum to USD177,836 million. Keep the actual quarterly disclosures rather than silently replacing one with a cumulative subtraction
10. Guidance lower/upper bounds computed from midpoint ± tolerance are explicitly labelled as derived. Guidance fiscal period labels are recorded; dates remain null when not explicitly established

## Verification performed

All eight records passed local JSON parsing, actual segment-plus-reconciliation sums, reported consolidated YoY rounding checks, publication/period/as-of date ordering, fixture-body hashes, and evidence-selector presence checks. Alibaba segment-table PDF pages 6 (June) and 8 (March) were visually inspected after Poppler rendering. This fixture-level verification does not assert that any production collector or parser passed integration tests.
