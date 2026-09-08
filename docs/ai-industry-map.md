# AI industry homepage: first release

The homepage is now an interactive industry map. Company search remains at
`/companies`, and existing ticker, prediction, watchlist, institutional, insider
and EOD routes retain their behavior. The navigation has an AI Map link.

## What is implemented

- Editorial starting universe: 16 US 10-K issuers across manufacturing, compute,
  memory/storage, networking, cloud/platforms and power/infrastructure. Segment
  placement is editorial, not evidence of a commercial relationship.
- Public read-only `/api/industry-graph`: one bounded read of those 16 latest run
  documents, a five-minute process cache and shared in-flight reads. HTTP caching
  can add another five minutes of freshness delay. No extraction, paid AI call,
  migration or Firestore write is triggered by a visitor.
- Current-version, completed, persisted extraction results only. Evidence must
  have the correct issuer CIK/ticker and accession, a date, a supported direction
  and relationship type, and valid confidence. Missing coverage is explicit.
- Search, one-hop exploration, up to eight expanded roots, relationship filtering,
  optional category targets, zoom, keyboard-selectable SVG nodes/edges, list view,
  an evidence panel with SEC links, and company/prediction continuations.
- A company-focused link can be copied and reopened (`/?company=MU`). This is a
  shareable focus link, not a saved account view or a snapshot of all filters.
- A link to the existing feedback form plus GA4 behavioral instrumentation.

The projection caps each issuer at 50 candidate edges, and the total preview at
60 nodes and 120 relationships. Omitted connections are reported. Issuer order
follows the editorial catalog; this bounded preview is not an exhaustive ranking
or a complete industry graph. Categories are hidden by default. Repeated evidence
for the same directed/type pair is grouped; reciprocal symmetric edges are grouped.

## Identity and data limits

The production demo companies/relationships were deleted at the user's request.
This release does not repopulate either collection. Map node IDs such as `sec:...`
are presentation references, not the future permanent company IDs.

An extracted target that uniquely matches an included issuer's display or legal
name is joined provisionally. The evidence panel labels that name match as pending
identity review. No fuzzy/acronym match or permanent entity merge is performed.
Other mentions and categories remain scoped to the source issuer. A solid outline
means the node has issuer metadata, not that every incoming relationship is verified.

Foreign issuers, private companies, subsidiaries and renamed entities need better
coverage and verified identity resolution. The 10-K pipeline does not yet support
20-F filings. Evidence dates are displayed, and an old extraction is never described
as a current commercial contract. The extraction confidence is not shown as
financial exposure, and manually seeded edges are never used as a fallback.

## GA4 measurement

The existing `GOOGLE_ANALYTICS_ID` deployment variable is reused. The inline Google
queue initialization runs before hydration so first-render events follow its config;
the remote Google script still loads after interaction begins. No second GA tag or
manual page-view sender is installed. Custom events are enabled only when that ID
is configured and the application environment is production. Existing page-view
configuration otherwise remains unchanged; these changes do not change consent.

| Events | Question answered |
| --- | --- |
| `industry_graph_view`, `industry_graph_load`, `industry_graph_error` | Do visitors reach a successfully loaded map? |
| `graph_search`, `graph_company_select` | Do visitors find companies of interest? |
| `graph_expand`, `graph_filter`, `graph_view_change` | Which exploration controls are useful? |
| `graph_evidence_open`, `graph_source_open` | Do visitors inspect supporting evidence? |
| `graph_company_open`, `graph_predict_click` | Does exploration lead to deeper research or a prediction? |
| `graph_save_view` | Is a company focus link successfully copied? (`method=copy_link`; not account saving) |
| `graph_feedback_click` | Do visitors open the feedback form? (Not a submitted response.) |
| `auth_start`, `auth_error`, `sign_up`, `login` | Where does authentication succeed or fail? |
| `prediction_publish` | Does the prediction API confirm successful publication? |

`sign_up` fires for successful email registration or a new Google account through
the auth page; login is separate. Publication fires only after a successful API
response containing an ID. Existing users also publish, so total publication events
must not be interpreted as first-time activations.

Each event carries `graph_version=v1` and `graph_origin=yes/no`. Origin means this
browser tab visited the graph within 30 minutes; optional session storage supports
that attribution. There is no cross-device identity join. Ad blockers, consent and
network loss can prevent delivery. Session attribution and funnel completion are
directional product signals, not an authoritative account/database count.

Raw search text, email, user IDs, document IDs, thesis text and evidence quotations
are not sent as custom event parameters. Search result count is capped at the eight
displayed suggestions. Private prediction content/ticker is not emitted on publication.

### Configure the GA4 property after deployment

1. Verify the existing production measurement ID points to the intended property.
   Validate the new events in Realtime/DebugView using a test browser, and exclude
   internal traffic when assessing organic visitors.
2. Register event-scoped custom dimensions for `graph_version`, `graph_origin`,
   `ticker`, `segment`, `relationship_type`, `node_kind`, `view_mode`, `method`,
   `action` and `visibility`. Optionally register custom metrics for coverage,
   node/edge counts and search result counts. Google requires custom definitions
   to use custom parameters in reporting; reporting availability can take 24–48
   hours: https://support.google.com/analytics/answer/14240153
3. Create a closed Funnel exploration for `industry_graph_view` ->
   `industry_graph_load` -> `graph_company_select` -> `sign_up` ->
   `prediction_publish`, allowing intervening events. This measures new registrants
   who subsequently publish; it does not require evidence clicks as an activation
   prerequisite. Start with a seven-day observation window, and inspect the graph
   origin dimension rather than requiring a 30-minute origin flag at every step.
4. Create a separate exploration for map load -> evidence open -> source open, and
   a table of selected tickers with users, expansions and evidence opens. Compare
   desktop/mobile and acquisition sources. Use user counts rather than raw click
   totals when comparing conversion. Funnel reporting reference:
   https://support.google.com/analytics/answer/13012015
5. Mark `sign_up` as a key event if desired. Keep total `prediction_publish` separate
   from the new-user activation funnel; a future server-side first-publication
   marker can establish authoritative first-prediction activation.

No GA property changes, remote reports or live collection verification are claimed
by this implementation. They require deployment and access to the GA4 property.

## Validation and rollout

Run `npm run test:industry`, `npm run test:graph`, `npm run test:conversion`,
`npm run lint`, `npm run typecheck`, and a production build. Browser fixtures render
the real homepage component with synthetic evidence, intercept network requests,
and never reach Firebase or Google Analytics. Their data is not a production fallback.

`npx tsx tests/industry/preview.ts` serves an isolated visual preview on localhost:4318.
For actual-app validation use the built Next server. Before publishing this homepage,
review the live run coverage and evidence for the starting companies. Missing data
is surfaced as coverage pending, not silently substituted with sample connections.

Live console inspection on 2026-09-07 found run documents for NVDA, AMD, AMZN and
MSFT among the starting universe. NVIDIA's inspected result was completed, current
version, persisted (`dryRun=false`), and reported 25 relationships from its
2026-02-25 filing. This confirms the stored result shape, not an audit of every
relationship or a live end-to-end test of the new endpoint. No data was changed.

Next: transactional company/identifier registry and dry-run issuer backfill, reviewed
counterparty resolution, broader filing sources, then account-saved views/company
following and onsite notifications. The recovered `src/lib/graph` library remains
separate; its old relationship labels are not mixed into this extraction ontology.
