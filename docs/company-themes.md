# Company theme memberships and collection scope

The existing `companies` collection stores one canonical record per company. A company may participate in multiple themes:

```json
{
  "themeIds": ["ai", "robotics"],
  "themeMemberships": {
    "ai": {"status": "PUBLISHED", "primarySector": "compute", "reviewedAt": "2026-10-04"},
    "robotics": {"status": "PUBLISHED", "primarySector": "compute-control", "secondaryRoles": ["software-simulation"], "reviewedAt": "2026-10-04", "sources": []}
  }
}
```

`themeMemberships` holds the editorial decisions, per-theme sector and reviewed sources. `themeIds` is the derived array of published memberships. Future membership edits must update both fields atomically. Withdrawn/draft memberships must not remain in the array. Memberships never imply a commercial relationship.

`loadThemeCompanies('robotics')` queries `companies.where('themeIds', 'array-contains', 'robotics')`, then checks authoritative publication status. Firestore's existing automatic single-field array index supports this query; no new collection or composite index is needed. A future compound query may require a separate index.

`loadCollectionUniverse()` unions the complete existing AI graph (including relationship neighbors) with companies having published supported-theme memberships. Canonical IDs deduplicate overlapping companies. It retains the original graph nodes, relationships and sources. Legacy `inGraph` / `aiGraph` enrollment is supported during rollout. Theme IDs are declared in one shared configuration, rather than per-job ticker lists.

The SEC scanner, news/exchange collector, earnings issuer discovery and subscriber, SEC/CN fundamentals and EOD price job use this union. The private-valuation job uses the same enrollment rules and its existing reviewed provider adapters. Directory/ticker jobs already cover the global directory. Explicit manual repair scopes and dry-run pilot tools retain their deliberately narrow scopes. A company without a verified SEC identity cannot enter the US earnings extraction path until the SEC scanner resolves it; this is an identity safeguard, not a pilot list.

## Historical enrollment

The one-time AI, Robotics and Space enrollment runners have been retired. Current enrollment uses `scripts/enroll-theme-companies.ts` with an explicit reviewed batch; see [theme enrollment](theme-company-enrollment.md). Historical backups and Git history retain the original migration evidence.

## Production migration verification

On 2026-10-04 (ET), the additive commit enrolled all 134 original AI companies and all 16 Robotics companies, with 147 distinct company IDs. The sole materialized profile was the previously displayed Samsung Electronics editorial identity. The verification compared all pre-existing fields on 146 company documents and all 320 stored relationship documents against the private pre-commit backup; none changed. After the graph cache expired, the public AI graph still contained the same 134 company IDs and 334 projected relationships. Replanning produced zero patches. All seven newly configured IR feeds returned ten valid, dated entries without rejected URLs.
