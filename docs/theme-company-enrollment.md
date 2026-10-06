# Add companies to an existing theme without a deployment

The live map reads the existing `companies` collection. Adding a canonical directory company to an existing sector does not require building or deploying the web app or collector jobs.

Use `scripts/enroll-theme-companies.ts` with a reviewed JSON batch. `data/ai-supply-chain/healthcare-enrollment.json` is the TEM/CAI example. A batch specifies the theme, review date, exact canonical identities, primary/secondary sector roles and official sources. AI batches may specify existing `aiStageIds` for the map's finer supply-chain stages.

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'ifindata-80905'
npx tsx scripts/enroll-theme-companies.ts --batch=data/ai-supply-chain/healthcare-enrollment.json
npx tsx scripts/enroll-theme-companies.ts --batch=data/ai-supply-chain/healthcare-enrollment.json --write
```

Use Application Default Credentials. When using an existing gcloud login instead, capture `gcloud auth print-access-token` into `GOOGLE_OAUTH_ACCESS_TOKEN` for this command, then remove that environment variable. Never put the token into the batch or command arguments.

The default is a dry run. Every run saves a private backup under ignored `output/company-theme-backups`. The write updates the membership and derived `themeIds` query index atomically, with exact document update-time preconditions. AI enrollment also supplies the existing `inGraph` projection required by the deployed AI graph reader. Existing identity, financial and relationship records remain intact. Conflicting editorial decisions stop the operation; reruns are idempotent. Missing canonical directory identities require a separate identity review.

The AI map cache expires within five minutes; Robotics/Space caches expire within one minute. The open workspace polls for refreshed data. The shared collector universe reads the published membership union, so SEC, fundamentals, earnings and price jobs include newly enrolled companies on their next run, subject to their normal identity/provider requirements. Enrollment does not fabricate supplier relationships or financial values.

Approved IR/news adapters live in `companies.newsSources`. Publish reviewed configurations using `scripts/publish-news-sources.ts --batch=<JSON>` (preview), then add `--write`. The healthcare feed batch is `data/ai-supply-chain/healthcare-news-sources.json`. Each feed includes its stable ID, matching canonical company ID, publication status, review date, HTTPS endpoint, approved hosts and supported parser settings. Draft/withdrawn feeds do not execute. Active duplicate IDs, unapproved hosts and unsupported adapters fail validation. This registry is shared by collection, feed projections, company announcements and calendar article extraction, with a one-minute cache. Existing source IDs retain their collector checkpoints and stored event associations.

`scripts/publish-news-sources.ts --migrate-existing` is a one-time additive migration from historical seed fixtures. The seeds remain for migration/audit and tests; production has no static fallback. New companies and feeds using existing adapters require no deployment. A new parser, theme, sector taxonomy or presentation still requires code changes.

The publisher checks source IDs across the complete enrolled registry before committing. The existing `collectors/news-source-registry` document holds a derived source-ID ownership guard, committed atomically with company updates using its update-time precondition. This prevents concurrent publishers from assigning a checkpoint/event source ID to different companies. Runtime readers continue to read feed definitions exclusively from company records.

On 2026-10-06, TEM and CAI were added to AI applications using the existing directory identities, with healthcare/precision-medicine descriptions and official company sources. No web or worker deployment was needed. Their classification does not imply that all revenue comes from AI software.
