# Company event timeline

Selecting a company in Graph, Tree, Hierarchy, or List opens a compact company card and a full-width research timeline at the bottom of the workspace. Company pages for US listings, China A-shares, and global/private companies use the same timeline and snapshot components.

The UI shows only one month (30 calendar days). Event symbols align to source publication dates above the price plot. Different dates never combine; symbols stack into extra levels when needed to avoid collisions. Only same-date events with matching symbols and colors share a small count badge. Clicking that symbol opens a scrollable event chooser over the chart without adding rows below it. Price and volume retain separate scales. Hovering over the chart shows the nearest stored trading date, closing price and volume; event markers retain event tooltips. There is no Sources axis label. The chart starts at 190px tall (216px on narrow screens), grows only for additional marker levels, and can close and reopen without closing the company card. Desktop cards initially extend to just above the timeline; dragging releases this docking, and Reset card position restores it.

Events come from existing curated primary-source announcements and public relationship evidence. Only source publication dates place events on the timeline. Review dates, ingestion dates, and future planned delivery dates are not substitutes. Current coverage is not a complete earnings or news calendar. Events with unknown publication dates are excluded.

The current Explore workspace (`/en?view=graph`) also shows the timeline below each of its four chart views when a company is selected, including exact ticker search. It uses the workspace's grouped source events and current source filter; selecting a marker opens the same company/event card as the right panel. Its fixed one-month range is independent of the right panel's Today/30d switch. Only events present in the loaded snapshot are shown, so the timeline does not claim complete historical event coverage.

`GET /api/company-timeline?company=US:AMD&days=30` reads existing `eod_prices` documents using the current `market_ticker_date` IDs and a bounded document-ID range. It creates no collections, adds no indexes, fetches no provider data, and performs no writes. Missing history remains missing; gaps longer than seven calendar days break the price line. Missing volume differs from recorded zero volume. Stored closes may be provider-adjusted according to the existing ingestion pipeline; this component does not redefine that pipeline. Private companies display available events without inventing public price history.

The endpoint currently supports the existing US and China A-share price-storage conventions. Its broader range support remains available to callers, while the timeline UI requests only 30 days.

Chart split adjustments read `corporate_actions` with a single-field `ticker` query, then filter by `market`, `type: "split"`, and `status: "completed"`. Each split supplies `effectiveDate` (the first trading session on the new share basis), `splitNumerator` (new shares), and `splitDenominator` (old shares). Completed actions after the chart's market date are excluded. Duplicate dates with equivalent ratios count once; malformed or conflicting completed splits make the endpoint return unavailable instead of serving a misleading chart.

For listings with split records and an explicit valid `rawClose`, chart OHLC uses the cumulative ratio of splits after each price date, through the chart's market date. This happens before aggregation and indicator calculation, and never rewrites `eod_prices`. EODHD volume is already split-adjusted and remains unchanged. Listings without split records, and rows without explicit raw closes, retain their stored close basis. This is a split-only chart basis, not a dividend total-return series. The normalized split list is included in the chart cache key, so adding, correcting, or removing an action invalidates the server's cached bars on the next request; HTTP responses have a 60-second cache lifetime.

## Local preview

Run `npm run dev -- --webpack --hostname 127.0.0.1 --port 3000` and open `/dev/company-timeline?view=graph`. The preview uses repository source evidence and explicitly labeled illustrative price/volume bars; it needs no local cloud credentials. Its server page returns not found outside development. Production components continue to use the read-only stored-history endpoint.

## Validation

`npx tsx --test tests/company-timeline.test.ts` checks publication-time placement, unknown dates, market isolation, nullable volume, and bounded event clustering. Browser checks also cover all four views, company-page rendering, dated event bands, close/reopen, event selection, and mobile overflow.
