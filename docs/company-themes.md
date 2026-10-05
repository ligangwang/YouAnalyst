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

## Additive migration

`scripts/migrate-company-themes.ts` defaults to preview. Supply an explicit project and a fresh public AI graph snapshot:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'ifindata-80905'
npx tsx scripts/migrate-company-themes.ts --graph=output/ai-before.json
npx tsx scripts/migrate-company-themes.ts --graph=output/ai-before.json --write
```

The script verifies the expected 134 distinct AI companies, all canonical Robotics identities, source-backed roles and editorial conflicts. It backs up original company documents, missing IDs, the public graph and all raw relationship documents before committing. Existing documents receive only `themeMemberships` and `themeIds`, fenced by exact update-time preconditions. The whole migration is one atomic commit; a concurrent edit aborts it. Reruns make no changes.

Only an explicitly missing, previously displayed NVIDIA editorial company profile may be materialized from its exact reviewed source-controlled identity. The migration neither replaces existing profiles nor creates arbitrary missing companies. In the production preview, Samsung Electronics was the sole missing profile. Its existing AI membership metadata is copied exactly, and its existing projected relationships continue to use the same IDs and sources.

After writing, the script verifies all original AI enrollments, graph fields, relationship documents and idempotence. Operational verification also compares all public company IDs and projected relationships before/after, allowing the existing five-minute graph cache to expire. Private backups are excluded from Git. No relationships, event records, financial fields, source checkpoints or scheduler definitions are rewritten.

The UI continues using its existing AI graph during this data/job rollout. A Robotics selector and theme-specific graph presentation are separate work; shared rendering needs no duplicated Robotics rendering tests. Tests here cover migration safety, overlap, per-theme query eligibility and job enrollment.

## Production migration verification

On 2026-10-04 (ET), the additive commit enrolled all 134 original AI companies and all 16 Robotics companies, with 147 distinct company IDs. The sole materialized profile was the previously displayed Samsung Electronics editorial identity. The verification compared all pre-existing fields on 146 company documents and all 320 stored relationship documents against the private pre-commit backup; none changed. After the graph cache expired, the public AI graph still contained the same 134 company IDs and 334 projected relationships. Replanning produced zero patches. All seven newly configured IR feeds returned ten valid, dated entries without rejected URLs.
