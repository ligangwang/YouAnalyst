# Company Map Data

The public map is a read-only view of persisted filing extractions. It does not invoke an AI provider or enqueue extraction when a visitor searches, opens a page, or saves a company.

## Membership And Metadata

- `company_graph_runs/{TICKER}_latest_10k` supplies published issuer membership. Only completed, persisted results using the current extraction version pass the projection's validation. New tickers need no code change.
- `industry_map_companies/{TICKER}` supplies optional display metadata: `name`, `segment`, `aliases`, `expectedCik`, `filingForm`, and `featured`.
- `featured: true` keeps a company visible as a starting point even before its own filing is covered. At most 40 featured records are loaded. This is not an extraction allowlist.
- Unknown segment values render under `other`; the application does not guess industry membership. Segment IDs are the existing layout taxonomy in `catalog.ts`.
- Aliases are provisional display joins, not persistent identity merges. Preserve `expectedCik` when a ticker has been reused by a different issuer.

Deployments run `scripts/migrate-map-directory.ts` with the deployment service identity. It creates missing initial metadata documents in a transaction, never overwrites existing records, and never deletes data. To retire a featured entry, set `featured` to false rather than deleting its bootstrap document. Subsequent editorial changes can be made in Firestore without deploying code.

## Paging And Coverage

`GET /api/industry-graph` reads 20 completed run documents plus one lookahead in document-ID order. `nextCursor` can be passed as `after` to visit subsequent pages. Invalid/stale extraction documents are not published; they still advance the cursor. `company=TICKER` additionally loads that company's persisted run, regardless of page position. A recognized active ticker without a published run receives a coverage state, not fabricated relationships.

Each response loads metadata for its issuers and featured companies. Rendering is bounded to 120 relationships, up to 50 candidate edges per issuer, and 40 additional mention nodes beyond the issuer directory. Omitted and withheld claims are reported separately. Connections reflect loaded filings, not a complete market-wide inverse relationship search. Exact ticker lookup works across pages; name search on the map searches the loaded data, with general company search available separately.

The per-process cache retains at most 32 request variants for five minutes. Failed reads are not cached as empty success. APIs use public caching only for public graph data; saved-company APIs remain authenticated and private.

## Release Checks

Run `npm run test:industry`, `npm run test:conversion`, lint, typecheck, and a production build. The regression suite covers non-bootstrap issuers, metadata overrides, pagination, direct ticker lookup, saved-company reopening, evidence provenance, and authentication isolation. Confirm the directory migration and production smoke tests succeed. The main sitemap currently includes up to 500 metadata and 500 completed-run documents, consistent with its existing bounded discovery approach; larger SEO coverage requires sitemap partitioning.
