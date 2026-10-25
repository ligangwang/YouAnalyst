# Supported company universe

This change is staged only: do not merge or deploy until the migration is reviewed
and its production execution is coordinated with the release.

`companies.onboarding` is the only new persisted map:

| Field | Type | Meaning |
| --- | --- | --- |
| status | QUEUED / PROCESSING / BLOCKED / SUPPORTED | Support lifecycle |
| version | 1 | Onboarding contract version |
| requestedAt | Timestamp or null | Accepted request; null for grandfathered coverage |
| startedAt | Timestamp or null | Workflow start; null for grandfathered coverage |
| supportedAt | Timestamp or null | Admission to the supported universe |
| updatedAt | Timestamp | Last lifecycle change |
| blockedReason | string or null | Operator-facing blocking reason |

No map means directory-only. No second support boolean, new collection, or new
composite index is introduced. This PR does not implement the onboarding request
queue, paid backfills, or search request actions.

`loadSupportedCompanies` queries the existing single-field index on
`onboarding.status == SUPPORTED`, excludes deleted/hidden/nameless records, and
sorts canonical IDs. Region filters derive from listing identities, not issuer
headquarters. `loadSupportedCompanyUniverse` projects the same records to the
metadata shape used by existing collectors; graph neighbors cannot expand it.
Each run must keep its returned IDs pinned; the existing EOD run-scope memoization
retains that snapshot. Individual request/repair jobs still process their explicit
targets, and portfolio/prediction pricing and benchmark coverage remain additive.

Existing collection-scope API names delegate to this selector, covering SEC and
CN fundamentals/market-cap refreshes, SEC filing discovery, earnings discovery,
calendar, publisher-news collection and article processing, daily EOD prices and
corporate actions, mapped price-history backfill/normalization, and hierarchy
coverage. Reviewed publisher adapters remain required independently of support.
Theme map rendering still uses published theme memberships; support does not
fabricate themes or relationships. Directory discovery remains directory-wide.

## Migration and rollout

1. Run `GOOGLE_CLOUD_PROJECT=<project> npx tsx scripts/migrate-company-onboarding.ts`
   in a healthy dependency environment. Default is read-only preview. Inspect the
   complete selected IDs and exclusive backup file under
   `output/company-onboarding-backups/`.
2. Review exclusions and conflicts. Published active catalog theme memberships
   qualify, as does existing legacy published AI enrollment without an explicit
   AI withdrawal. Deleted, hidden, draft-only, withdrawn-only, and directory-only
   companies do not qualify. Already supported records are unchanged. Any other
   onboarding state on a qualifying company stops the plan before writes.
3. Before any production apply, start a fresh bounded availability/error/backlog
   monitor. Apply with `--write` only in the authorized release window. The script
   uses five-document commits, a one-second inter-batch pause, exact updateTime
   preconditions, backups, and immediate readback. Stop further batches on capacity
   errors; do not retry a partially applied migration blindly. Re-preview first.
4. Each write touches only the new onboarding map and the existing root
   `updatedAt` timestamp for cache propagation. Preserve all theme, identity,
   financial, price, and profile fields. Grandfathering records existing coverage;
   it does not claim that new onboarding checks/backfills were executed.
5. Complete migration and cache visibility verification before deploying the strict
   selector. A missing onboarding map deliberately has no theme-based fallback.
   Keep old production readers serving throughout this additive migration.
6. After candidate verification and normal protected deployment, compare all job
   scopes with the migration's supported IDs and verify normal queues and errors.

Routine refresh failures do not clear SUPPORTED. New onboarding may set SUPPORTED
only after its mandatory readiness checks pass. No production migration or release
was performed as part of preparing this change.
