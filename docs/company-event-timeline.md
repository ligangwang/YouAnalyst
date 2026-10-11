# Company event timeline

Selecting a company in Graph, Tree, Hierarchy, or List opens a compact company card and a full-width research timeline at the bottom of the workspace. Company pages for US listings, China A-shares, and global/private companies use the same timeline and snapshot components.

The default range is one month (30 calendar days), matching the limited initial historical coverage. Three months, six months, one year, and five years remain available; the chosen range is remembered locally and retained across views and companies. Business announcements and relationship source disclosures occupy separate lanes above close and volume. All panels use one continuous calendar-date axis, including weekends. Nearby markers cluster within their own lane; choosing a cluster exposes its individual dated sources. Date anchors do not move when events cluster.

Events come from existing curated primary-source announcements and public relationship evidence. Only source publication dates place events on the timeline. Review dates, ingestion dates, and future planned delivery dates are not substitutes. Current coverage is not a complete earnings or news calendar. Events with unknown publication dates are excluded.

The current Explore workspace (`/en?view=graph`) also shows the timeline below each of its four chart views when a company is selected, including exact ticker search. It uses the workspace's grouped source events and current source filter; selecting a marker opens the same company/event card as the right panel. Its remembered timeline range is independent of the right panel's Today/30d switch. Only events present in the loaded snapshot are shown, so the timeline does not claim complete historical event coverage.

`GET /api/company-timeline?company=US:AMD&days=30` reads existing `eod_prices` documents using the current `market_ticker_date` IDs and a bounded document-ID range. It creates no collections, adds no indexes, fetches no provider data, and performs no writes. Missing history remains missing; gaps longer than seven calendar days break the price line. Missing volume differs from recorded zero volume. Stored closes may be provider-adjusted according to the existing ingestion pipeline; this component does not redefine that pipeline. Private companies display available events without inventing public price history.

The endpoint currently supports the existing US and China A-share price-storage conventions. Five years of history is selectable but does not guarantee that five years has been stored.

## Local preview

Run `npm run dev -- --webpack --hostname 127.0.0.1 --port 3000` and open `/dev/company-timeline?view=graph`. The preview uses repository source evidence and explicitly labeled illustrative price/volume bars; it needs no local cloud credentials. Its server page returns not found outside development. Production components continue to use the read-only stored-history endpoint.

## Validation

`npx tsx --test tests/company-timeline.test.ts` checks publication-time placement, unknown dates, market isolation, nullable volume, and bounded event clustering. Browser checks also cover all four views, company-page rendering, range persistence, source selection, and mobile overflow.
