# Live US extraction validation

The five small HTML files here are **authored factual shape examples**, not publisher documents or full captures. They contain only financial labels, disclosed values, and minimal reporting-period context. They exercise EDGAR table cell boundaries, especially NVIDIA's separate percent-sign cells, Microsoft's quarterly versus annual columns and reported versus constant-currency growth, and Alibaba's native RMB versus convenience USD columns.

`provenance.json` records the exact URLs, byte counts, and original-byte SHA-256 hashes of twelve complete official documents downloaded and validated locally on 2026-10-02:

- Latest disclosed NVIDIA, AMD, Microsoft, and Alibaba earnings exhibits, from SEC EX-99.1
- Preceding Microsoft and Alibaba earnings exhibits, from SEC EX-99.1
- Latest and preceding NVIDIA and AMD releases, from their approved issuer sites
- Latest and preceding Alibaba releases, from its approved PDF host

The numeric assertions and fiscal dates are independently sourced from the existing reviewed `../us/*.json` pilot facts. Full copyrighted documents are intentionally absent from the repository. HTML is converted by the production `htmlToEarningsText`; PDFs use `pdftotext -layout`. The opt-in test requires all files listed in the manifest and companion `.txt` files for the PDFs, and checks original-byte hashes before extraction:

```sh
EARNINGS_US_SOURCE_DIR=/path/to/verified/downloads node --import tsx --test tests/securities/earnings-live-us.test.ts
```

Normal test runs use the authored examples and adversarial mutations without network access. The optional full-source test is explicitly skipped unless a directory is supplied.

The resolver extracts consolidated quarterly revenue and reported YoY; NVIDIA/AMD numeric QoQ is included when explicitly reported. A textual `Flat` QoQ is omitted. All currency amounts retain their native scale, recorded as millions with normalized base-unit values. The live adapter deliberately leaves segments and guidance `not_extracted`; the earlier curated pilot's richer optional coverage is not claimed as live coverage. It does not subtract YTD values or fill unsupported formats from another source. Fiscal dates, years, quarters, values, and source IDs are never hardcoded into the adapter.

Announcement dates are selected only from unique, issuer-specific literal bylines (or NVIDIA’s date immediately above its release opening). Missing, ambiguous, or invalid bylines leave the date unavailable. Date-only observations never replace source publication or SEC filing-acceptance metadata.

`alibaba-sec-announcement.html` is a compact authored regression for the formal March-quarter SEC announcement. Its joint quarterly/annual heading and wrapped summary heading are verified against the separately hashed SEC source. The adapter still selects only the three-month RMB revenue columns, rejects changed or ambiguous headings, and leaves announcement date null because this format has no supported opening byline. This deployed-format correction uses adapter version `us-live-2`.
