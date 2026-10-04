# AI Map event collection

Collector scope comes from the current knowledge graph, rather than the earnings extraction pilot. At validation on 2026-10-03 the map contained 68 US listings, 62 mainland China listings and four organizations outside these filing venues.

- The existing SEC collector resolves every US map ticker and shares its submissions cache with financial discovery and earnings processing. The universal event observer includes 8-K (including Item 2.02 earnings announcements), 6-K, 10-Q, 10-K, 20-F and 40-F, including amendments. A 6-K is not labeled earnings without additional source classification.
- The existing company-news job also collects China announcements from CNINFO for every mapped XSHG/XSHE issuer. Exact issuer lookup, complete pagination and original PDF publication dates are validated before advancing a company checkpoint. SEC/China discovery therefore does not depend on a financial metric parser being available.
- Verified IR/news adapters cover 65 US map companies. ASML, Eaton and Palantir IR adapters are explicitly held for review; their SEC disclosures remain collected. The registry records the reason and does not poll these unsupported pages. Source validation can still report partial feeds where individual links or original dates are unavailable.

Both news and disclosures use the existing `events` collection. Collector leases, progress and errors use the existing `collectors` collection. No new collections or scheduled jobs are introduced. The company-news schedule stays hourly Monday–Friday in America/New_York; the existing SEC and earnings schedules remain in place.

Initial disclosure history starts January 1, 2026. Subsequent scans overlap seven days, preserve the first collection/processing timestamps and create each document once. Source publication timestamps remain separate; date-only China and publisher records never receive an invented intraday time. News budgets and China rotation defer unfinished work to later runs. RSS retention is publisher-dependent, so a registered feed does not promise a complete year of historical news.

The earnings processor consumes the shared SEC/China discovery path instead of independently polling China issuers in production. Financial metric extraction continues to use the validated company parsers; collection coverage does not imply metric extraction coverage. Supported original source documents retain the existing durable earnings outbox.

The command center reads bounded event queries and merges identical source URLs. Company pages link collected announcements and periodic reports, independently of the older static company profile. Different IR and SEC URLs remain separate source documents unless their identity is explicitly established; dates or similar titles alone do not prove duplication.

Read-only validators (no Firestore access or writes):

```sh
npx tsx scripts/validate-map-sources.ts
npx tsx scripts/validate-map-sec.ts /path/to/map-company-inventory.json
npx tsx scripts/validate-map-exchange.ts /path/to/map-company-inventory.json
```

The inventory is an array with each company's `id` and `market`, exported from the current public graph. Validation checks public source reachability and schemas; production source health is established only after the deployed workers complete their scans. Provider blocks retain checkpoints and the existing shared cooldowns. No alternate identities, cookies or access-control bypasses are used.
