# Company Map Data

The public map is a read-only view of persisted filing extractions and explicitly published industry research. It does not invoke an AI provider or enqueue extraction when a visitor searches, opens a page, or saves a company.

## Adding Industry Coverage

Open `/admin/industry-research` (also linked from Company Graph Requests). Sign in as an admin, enter an industry and choose **Research industry**. This uses the production `OPENAI_MODEL` (currently `gpt-5.4`) with medium reasoning and web search. One background response researches up to 30 companies and 40 candidate relationships across the industry, targeting 15-25 concise connections per batch rather than requesting each company independently. The initial integration accepts US-listed stocks and ADRs supported by the ticker directory; private companies and foreign-only listings are excluded.

Runs are saved in `industry_research_runs`. Refreshing checks the existing OpenAI response; it never starts a replacement. Only completed structured output becomes a draft. Source URLs must occur in the provider's web-search sources or citations. This establishes source provenance, not that the model's interpretation is verified. Summaries are paraphrases and must not be presented as source quotations.

Review the company identities, direction, date and linked source for each proposed connection. Select the connections that the sources support, then choose **Publish reviewed connections**. Publication validates the ticker directory and atomically writes:

- `industry_research_companies/{TICKER}`: one reviewed display record per ticker, created only when absent.
- `industry_research_relationships/{SOURCE}__{TYPE}__{TARGET}`: one canonical relationship, with merged evidence and contributing industry/run IDs.
- The draft run's publication selection and reviewer audit fields.

`AMD CUSTOMER_OF TSM` and `TSM SUPPLIER_OF AMD` share one key. Partner and competitor keys sort their endpoints. Publication merges evidence rather than creating duplicate connections. Existing display metadata is never silently overwritten. Omission from another batch does not retire a relationship. To withdraw a published research relationship, change its `status` to `RETIRED` in Firestore; do not delete its audit history. Publication of that relationship again requires explicit review.

The map reads up to 120 published research relationships, plus up to 80 outgoing and 80 incoming records for a requested ticker, and joins existing map nodes by ticker. Exact ticker lookup can reach companies outside the overview. This is a bounded preview, not a claim of market completeness. The existing filing cursor pages filings, not research. Larger research coverage will need its own industry selector and pagination. Web research is labeled separately and does not increase the count of companies with published filing extractions. New published companies need no deployment and appear after the existing five-minute cache expires. Industry research companies are not yet added to the sitemap automatically.

### Ticker Directory Recovery

If publishing reports that a ticker has no supported active listing, refresh the ticker directory before retrying the saved draft. The default ticker sync includes common stocks, ETFs, American Depositary Receipts and Depositary Receipts traded in the United States in USD. Older syncs excluded depositary receipts such as TSM.

After deploying the updated sync, call `POST /api/internal/sync-tickers` using the configured internal authentication, first with `{"dryRun":true}` to review the result, then with `{"dryRun":false}` to import it. Omit `types` to use the updated defaults and omit `limit` for the full directory. Existing jobs that explicitly pass only `Common Stock` and `ETF` must also update or remove their `types` override. The sync merges listing records; it does not publish research. Retry **Publish reviewed connections** on the existing draft after the sync succeeds.

### Spending And Recovery

The server enforces three submitted batches per UTC day, at most eight built-in tool calls and 12,000 output tokens per batch. These bound work, not an exact dollar cost: input/search-content tokens and tool fees also apply. Token usage is recorded with purpose `industry_research`; its token-cost estimate excludes search-tool fees, while each run records the number of tool calls. No scheduler is enabled.

Client request IDs prevent duplicate starts on retries. A per-industry lock prevents overlapping research. Failed or incomplete results never alter published data. If a process stops in `STARTING`, inspect provider usage before releasing its `industry_research_locks` record; do not automatically retry an uncertain paid request. **Check status** retrieves the same response for processing or failed runs without starting new research, including provider failure diagnostics. OpenAI background response retention is limited, so refresh promptly; completed results are persisted in Firestore.

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
# Research Categories

The Industry Research form uses the April 2026 GICS sector/industry structure
(11 sectors, 74 industries) as research topic labels. The versioned catalog is
`src/lib/industry-research/taxonomy.ts`; review it when MSCI publishes structural
changes. These labels are not official company-level GICS assignments.

Select a sector and industry, optionally refine the scope, or choose Custom /
cross-industry. The server validates parent codes and stores canonical names,
codes, scope and taxonomy version in each run's `topic`. Published relationships
merge `researchIndustryCodes` and `researchSectorCodes` without replacing older
memberships. The recent-run sector filter covers the ten latest runs; legacy
runs remain available as Custom / uncategorized. No additional model requests
are triggered by selecting or filtering categories.

Map layout categories are separate from the research taxonomy. `applications`
and `healthcare` supplement the existing roles; `other` remains a fallback.
The directory migration classifies AI/TEM as AI applications and HIMS/LLY as
healthcare based on company descriptions linked in its migration data. It adds
no relationships or featured coverage, preserves existing classifications, and
does not reapply a completed correction. Future research uses these roles in
the existing structured schema; assignments remain in Firestore, not a runtime
ticker allowlist. A role is not proof of a supply-chain connection.
