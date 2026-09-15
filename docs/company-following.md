# Company following and research updates

## Private following

Company pages and the 3D map detail panel share `CompanyFollowButton`. Following is
independent of prediction watchlists, billing and bullish/bearish calls. The existing
Watchlists area hosts `/watchlists/following`; navigation and the owner's profile link
to it. Existing prediction watchlists retain their original behavior.

`/api/map-follows` authenticates Firebase ID tokens and uses only the token's UID.
The existing `industry_map_preferences/{uid}` document stores canonical company IDs;
legacy US `tickers` are read and mirrored transactionally for compatibility with
`/api/knowledge-graph/saved`. No new collection or public profile field is introduced.
The Firestore client rules do not expose these documents. Responses are private and
uncacheable. The browser shares follow state, serializes writes, discards obsolete
reads and refreshes on account changes, window focus and cross-tab notifications.

For signed-out visitors, `followCompany` is carried inside the validated local auth
destination, preserving locale, query and fragment. Auth persists the intended follow
before returning. If persistence fails, the signed-in visitor can retry on the auth
page without losing the destination. Tokens are never put in the URL or local storage.

## Company research

The same published knowledge graph powers company roles, suppliers, customers and
partners. Facts expose only allowlisted fields linked to published evidence. Each
fact keeps its documented/announced status, product or business scope, original source
description, source link and date. Core role and relationship explanations are
available in English and Chinese; original evidence remains in its source language.
Relationship anchors support links from updates. Listing data and tables follow the
research panel. The homepage 3D graph is preserved.

## Initial update coverage

`/api/company-updates` authenticates the viewer and derives the filter from that
viewer's persisted follows. It includes sourced graph facts with an actual research
review/publication timestamp and matching records from the latest 50 public SEC
Form 4 / 13F feed disclosures. This is a bounded recent-disclosure window, not a
complete announcement or news archive. Filings failures are shown separately.

Research items describe evidence being collected/reviewed, not necessarily a new
business event. Event dates are shown only when explicitly supplied; source dates
and collection/review dates are separate. Legacy relationships without a collection
timestamp are omitted from updates. There is no inferred event date or synthetic
news. Following both endpoints still yields one item per fact. The latest reviewed
fact is shown; this is not a historical log of every edit or deleted relationship.

The Following page and Feed's Following filter use this endpoint and link directly
to the relevant company section. With no supported items they show an explicit empty
state. Initial scope is the researched AI company graph, not all listed companies.

## Verification

- Graph tests: safe auth continuations, exact follow matching, deduplication, source
  date separation, planned wording, direction and public fact projection.
- Existing follow handler tests: token ownership, private responses, validation and
  idempotent writes.
- Conversion tests on desktop/mobile: registration and persistence failure/retry,
  return location, shared follow state, reload, account isolation, Chinese research,
  source links and update deep links.
