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

No map means directory-only. There is no second support boolean or new composite
index. The separately approved `company_onboarding_requests` collection holds
resumable requests. Search request UI remains a separate change; the queue-only
POST endpoint and operator worker are included here.

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

## Onboarding worker (staged, not provisioned or scheduled)

The maintenance image includes `dist/onboard-companies.cjs`, without changing its
default command or creating any job, topic, subscription, schedule, IAM binding,
or production data. Locally the entry point is `scripts/onboard-companies.ts`.

The approved request fields are `companyId`, `version`, `status`, `requestedAt`,
`updatedAt`, `targetThrough`, `steps`, `attemptCount`, `nextAttemptAt`, `leaseOwner`,
`leaseExpiresAt`, and `lastError`. Canonical company ID is the document ID. Times
are ISO strings except retry/lease times (Unix milliseconds). `steps` maps the
fixed stage names to COMPLETE; an absent stage is unfinished. No raw credentials
or provider URLs are persisted in failure messages.

`POST /api/company-onboarding/requests` accepts `{companyId}` and only records
intent. It deduplicates without restarting blocked requests or invoking providers.
US requests require a matched company CIK. A-share requests currently support
XSHG/XSHE identities supported by existing price/fundamental workers. Beijing and
other unsupported listings are rejected explicitly, not silently marked supported.

Operator commands (require explicit project credentials):

```
npx tsx scripts/onboard-companies.ts                         # preview; no mutations/providers
npx tsx scripts/onboard-companies.ts --company=US:EXAMPLE --enqueue
npx tsx scripts/onboard-companies.ts --process --limit=1
npx tsx scripts/onboard-companies.ts --company=US:EXAMPLE --resume
```

Processing uses the existing EODHD token/bucket environment configuration. One
invocation runs one stage per company; default limit is one and maximum is five,
processed sequentially. A 20-minute ownership lease fences checkpoint completion;
expired or replaced owners cannot publish support. Retryable failures use bounded
exponential backoff (one minute to six hours), blocking after eight failed attempts.
Operator-only resume preserves prior checkpoints; public requests cannot resume.

Stages:

1. Verify public canonical identity and synchronize its existing instrument.
2. Apply reviewed theme enrollment batches and verify published source evidence.
   `--theme-batches=<file>` accepts an array in the existing enrollment format.
   Without reviewed classifications the request blocks for review. This worker
   does not invent theme membership or claim to perform autonomous theme research.
3. Verify the reviewed profile description.
4. Fetch and validate both split and dividend histories from 2020-12-30 through the
   pinned cutoff. Empty successful histories are valid; provider failures are not.
   Preserve raw dividend fields in existing `corporate_actions.sourcePayload`,
   including adjusted/unadjusted amounts and currency, without new typed columns.
   Reuse immutable private response caches, reconcile removed provider events, and
   preserve original creation metadata. See [EODHD's corporate-action contract](https://eodhd.com/financial-apis/api-splits-dividends).
5. Backfill prices from 2020-12-30 (providers naturally start later for later IPOs).
   Existing prices are preserved. Range-specific receipts prevent a completed 2025
   backfill from hiding missing earlier data. Writes are bounded to five per batch
   with a one-second pause and ownership checks; publish the latest close through
   the existing conditional latest-price writer.
6. Reuse the SEC or A-share annual-financial worker for this company alone.
7. Reuse existing market-cap/derived metric calculations; never synthesize values
   for unavailable inputs.
8. Verify evidenced theme graph entry points. Zero commercial edges is valid;
   onboarding does not fabricate relationships or replace the existing research
   extraction/review system.
9. Verify routing prerequisites for normal supported-company collectors.
10. Recheck themes, financial issuer/metrics, and every stored historical price.
    Catch up prices/actions if a completed market session elapsed during onboarding.
    Atomically mark both request and company SUPPORTED only after verification;
    concurrent company/theme edits require another verification pass.

Existing financial-feature readiness means the report and numeric metrics consumed
by the current UI, not an invented promise of complete historical statements.
Transient provider failures remain retryable. Definite missing classification,
profile, identity, or unavailable required financial data blocks admission.

`COMPANY_ONBOARDING_MAINTENANCE_READY=1` is an operator release gate: set it only
after the shared supported selector and normal collectors have been deployed and
verified. Until then final admission blocks. No user follows/subscriptions are
modified, and historical downloads do not replay old news notifications.

Before any eventual production run, use a new bounded availability/backlog monitor,
stop further work on capacity errors, and begin with one company. This PR and its
preview do not authorize deployment or bulk enrollment.
