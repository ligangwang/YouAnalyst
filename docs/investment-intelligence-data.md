# Investment Intelligence data

The real-data workspace is `/en/intelligence` (also localized through the existing routing middleware). `/api/intelligence` reads published company relationships and their primary evidence, plus the existing SEC filing discovery ledger. The mock workspace remains development-only.

No new Firestore collection is required. `sec_filings` gains `intelligenceObservedAt`, the earliest actual pending/published discovery time. Baseline imports never count as arrivals. Collector retry writes preserve that original time. Existing `company_fundamentals/_sec_filings_collector` stores the resumable backfill cursor and completion marker.

The API caches one shared snapshot for 60 seconds, bounds SEC reads to 200 recent records, and discloses truncation. During migration it also queries a bounded 30-day filing window. Browsers poll every 60 seconds, pause while hidden or replaying, and keep last received data with a disconnected notice on failure. Failures never return demo data. Collector freshness is checked separately from successful database reads.

Research records cluster by canonical source URL. A source cited by several relationships counts as one document. Existing documented paths survive a matching SEC filing arrival. Co-mentions never create business relationships. Publication/business dates remain separate from recorded/review dates. Date-only reviews appear in recent evidence but are excluded from intraday replay. Replay covers today's Eastern-time session and reads the loaded snapshot without extra backend queries.

X, Reddit and GitHub remain unavailable until actual ingestion is connected. IR and exchange documents currently represent stored research evidence, rather than separate live arrival feeds.

## Verification and rollout

1. Run `npm run test:graph` and `npm run test:securities`, type checking, lint and a production build.
2. With authorized Firestore credentials for the existing production project, run `npx tsx scripts/backfill-intelligence-observations.ts` for a read-only preview. Run with `--apply` to persist existing discovery timestamps. Each invocation processes at most 2,000 records; repeat until complete. Do not manufacture arrival times for historical records.
3. Update the existing SEC collector worker so future discoveries write the indexed field. The current background job change detector includes `src/lib/sec-filings/store.ts`.
4. Verify `/api/intelligence` on a connected runtime: bounded query succeeds, collector freshness is known, a known accession appears once, baseline history is excluded, and unavailable-source status is accurate.
5. Verify Today, recent evidence, selected primary-source links and replay with actual timestamped arrivals before enabling this workspace as the default home page.

For local visual review only, `INTELLIGENCE_DEV_PUBLIC_GRAPH=1 npm run dev` reads the existing public production graph. This switch is ignored outside development and explicitly states that SEC arrival coverage is not verified locally. It is not a mock fallback.
