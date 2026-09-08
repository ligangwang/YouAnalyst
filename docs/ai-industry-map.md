# AI industry homepage

The homepage is now an interactive industry map. Company search remains at
`/companies`, and existing ticker, prediction, watchlist, institutional, insider
and EOD routes retain their behavior. The navigation has an AI Map link.

## What is implemented

- Editorial starting universe: 19 companies (18 supported 10-K issuers plus TSMC) across manufacturing, compute,
  memory/storage, networking, cloud/platforms, power/infrastructure and devices/edge AI. Segment
  placement is editorial, not evidence of a commercial relationship.
- Public read-only `/api/industry-graph`: one bounded read of the 18 supported latest run
  documents, a five-minute process cache and shared in-flight reads. HTTP caching
  can add another five minutes of freshness delay. No extraction, paid AI call,
  migration or Firestore write is triggered by a visitor.
- Current-version, completed, persisted extraction results only. Evidence must
  have the correct issuer CIK/ticker and accession, a date, a supported direction
  and relationship type, and valid confidence. Missing coverage is explicit.
- A compact overview initially shows starting companies and evidence-backed connections
  between them. Selecting a company reveals its filing mentions; Show all connections
  restores the full bounded preview. Search always includes the hidden mentions.
- Search, one-hop exploration, up to eight expanded roots, relationship filtering,
  optional category targets, zoom, keyboard-selectable SVG nodes/edges, list view,
  an evidence panel with SEC links, and company/prediction continuations.
- Columns wrap to the available panel width at readable text sizes. Focus on this
  company replaces the current roots; Back to industry overview clears the focus
  and filters. Desktop/mobile navigation temporarily omits How It Works; the page remains.
- A company-focused link can be copied and reopened (`/?company=MU`). This is a
  shareable focus link, not a saved account view or a snapshot of all filters.
- A link to the existing feedback form plus GA4 behavioral instrumentation.
- Overview discovery questions expose NVIDIA's incoming suppliers and Micron's
  and TSMC's outgoing supply relationships. Only directed, non-category supplier
  edges with evidence contribute; empty questions are hidden. Counts describe
  the bounded map, not complete customer/supplier lists. Selecting a question
  focuses only those matching edges. Company selection, filters and reset leave
  that guided view so ordinary exploration remains available.
- Registered users can save supported ticker companies to a private account list
  above the map, reopen their connections, and remove saves. A selected company's
  save card explains this benefit before registration. Authentication returns to
  that company; the user then explicitly selects Save. No mutation occurs merely
  by opening a continuation URL. This saves company shortcuts, not graph snapshots
  or notifications, and does not change prediction-based watchlists.
- The same save benefit appears beside relationship evidence. It retains the
  explored company when that company is an endpoint, otherwise uses the filing
  issuer. Registration links request `mode=register` while preserving the company
  continuation; existing users can switch to sign-in. Other auth entry points
  retain their default mode. Email forms support Enter and password autofill.

## Saved company access and measurement

`/api/industry-graph/saved` requires a verified Firebase bearer token for GET and
POST, derives ownership only from that token, and returns `private, no-store`
responses including errors. Server-only `industry_map_preferences/{uid}` documents
hold a bounded set of starter tickers. Existing Firestore rules deny direct client
access to this new collection. Atomic array membership updates make repeated
save/remove requests idempotent without overwriting concurrent saves of other
companies. No collection migration, financial computation or extraction is needed.
Account changes hide previous saves immediately and ignore late responses.

Deployment smoke tests use a Cloud Run service identity token, which is not a
Firebase user session. Saved-data checks pass infrastructure authorization via
`X-Serverless-Authorization` separately and verify that anonymous requests and
service identities cannot read user saves. A positive authenticated read test
requires an explicitly supplied `PLAYWRIGHT_FIREBASE_ID_TOKEN`; it is skipped when
that user-session credential is absent. Save/remove and account isolation are
covered by isolated API and browser tests without writing production user data.

GA4 adds `graph_save_intent` (actions: sign_in/save/remove), `graph_save_complete`
(save/remove, only after success), `graph_save_error`, and `graph_saved_company_open`.
Compare visitors who inspect evidence, click save intent with sign_in, register
(`sign_up`, graph_origin=yes), complete a save, return to a saved company, and
eventually publish (`prediction_publish`). Saving is an intermediate engagement
signal; it is not counted as publishing a first prediction. No account IDs, tokens
or private lists enter analytics. Existing GA4 events are unchanged. Production
event configuration and funnel reports still need observation with real traffic;
these events alone do not establish an increase in registrations.

`graph_discovery_open` records an allowlisted question ID, ticker and displayed
edge count. Save-intent events distinguish `entry_point=company` from `evidence`.
Use these to compare discovery → evidence → save intent → registration with the
existing graph-origin attribution; no raw query or filing excerpt enters GA4.

The projection caps each issuer at 50 candidate edges, and the total preview at
60 nodes and 120 relationships. Omitted connections are reported. Candidates are
interleaved one per issuer per round, in editorial catalog order, so a dense early
issuer does not consume the entire node budget before later issuers contribute.
Validation and merging can still produce different counts per issuer; this is not
an equal quota or a financial ranking. This bounded preview is not an exhaustive ranking
or a complete industry graph. Categories are hidden by default. Repeated evidence
for the same directed/type pair is grouped; reciprocal symmetric edges are grouped.

## Identity and data limits

The [2026-09-08 evidence audit](relationship-quality-audit.md) documents review of
77 company-API relationships. A shared read-time review layer corrects nine exact
records and withholds three unsupported claims on the company API and industry
map. Original extraction data remains intact; new filings or changed signatures
do not inherit corrections. Amended evidence shows its review reason and date.
Withheld claims are counted separately from the bounded preview's omitted edges.
This is not blanket verification of future extractions or permanent identity resolution.

The production demo companies/relationships were deleted at the user's request.
This release does not repopulate either collection. Map node IDs such as `sec:...`
are presentation references, not the future permanent company IDs.

An extracted target that uniquely matches a starter's editorial name/alias or an
included issuer's legal name is joined provisionally, even before the target's own
filing is extracted. The evidence panel labels that name match as pending
identity review. No fuzzy/acronym match or permanent entity merge is performed.
Other mentions and categories remain scoped to the source issuer. A solid outline
means the node has issuer metadata, not that every incoming relationship is verified.

Foreign issuers, private companies, subsidiaries and renamed entities need better
coverage and verified identity resolution. The 10-K pipeline does not yet support
20-F filings. TSMC (NYSE: TSM) is an explicit manufacturing starting point despite
that limitation. Its known names in NVIDIA, AMD and Qualcomm filings join to one
provisional TSMC node; the map does not claim to have extracted TSMC's own filing.
The loader skips a nonexistent TSM latest-10-K lookup, and its panel explains the
20-F coverage gap. Search accepts TSM, TSMC and the catalog's legal-name aliases.
Intel remains available under Compute; this simplified editorial placement does
not deny its foundry business. Sources: [TSMC annual reports](https://investor.tsmc.com/english/annual-reports)
and [Intel's business structure](https://www.intc.com/news-events/press-releases/detail/1687/intel-outlines-financial-framework-for-foundry-business).
Evidence dates are displayed, and an old extraction is never described
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
| `auth_start`, `auth_cancel`, `auth_error`, `sign_up`, `login` | Where does authentication succeed, get canceled or fail? |
| `prediction_publish` | Does the prediction API confirm successful publication? |

`sign_up` fires for successful email registration or a new Google account through
the auth page; login is separate. Publication fires only after a successful API
response containing an ID. Existing users also publish, so total publication events
must not be interpreted as first-time activations.

Each event now carries `graph_version=v2` and `graph_origin=yes/no`. Compare v2
with the first release's v1 when evaluating the navigation changes.
`graph_view_change` also records `action=all_connections`, `industry_overview`,
or `focus_company`, while preserving `view_mode=map/list`.
Origin means this
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

For the second iteration, public read-only checks confirmed existing current-version
data for AAPL (6 collapsed edges, filing dated 2025-10-31) and QCOM (10 collapsed
edges, filing dated 2025-11-05). These counts are from the company endpoint, not
guaranteed counts in the bounded industry projection. The catalog now includes
both issuers under Devices & edge AI. No new extraction was run; all other missing
filings remain pending. The industry's completed/persisted validation still applies.

Next: transactional company/identifier registry and dry-run issuer backfill, reviewed
counterparty resolution, broader filing sources, then account-saved views/company
following and onsite notifications. The recovered `src/lib/graph` library remains
separate; its old relationship labels are not mixed into this extraction ontology.
