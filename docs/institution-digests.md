# Institution Digests

Institution digests are in-app snapshots for users who follow institutional managers. They do not send email. A generated run is saved in `institution_digest_runs` and appears in the user's Institutions page.

## User Flow

- Users enable digests from the Institutions page preferences panel.
- Generated live digest runs appear in the Institution digests panel.
- Users can open a run, group items by institution or ticker, follow SEC filing links, and mark live runs as read.
- Dry runs are admin previews only and do not write digest run records or update user checkpoints.

## Admin Operation

Admins can open `/admin/institutions/digests`.

- Keep `Dry run` enabled for previews.
- Use explicit user IDs to test one or more accounts before a broad run.
- Disable `Dry run` only when ready to update each user's `settings.institutionDigestLastSentAt`.
- Live runs require the confirmation checkbox before the API will checkpoint users.

The admin API is:

```http
POST /api/admin/institutions/digests
```

```json
{
  "action": "run",
  "dryRun": true,
  "limitUsers": 50,
  "limitItems": 50,
  "userIds": ["firebase-user-id"]
}
```

For scheduled jobs, call the internal endpoint from trusted infrastructure:

```http
POST /api/internal/institutions/digest
Authorization: Bearer <INTERNAL_API_TOKEN>
```

Use a dry run first:

```json
{
  "dryRun": true,
  "limitUsers": 50,
  "limitItems": 50
}
```

Then run live when the preview looks correct:

```json
{
  "dryRun": false,
  "limitUsers": 50,
  "limitItems": 50
}
```

## Scheduler

The deploy workflow can provision a Cloud Scheduler job for `/api/internal/institutions/digest`. It is disabled unless `INSTITUTION_DIGEST_SCHEDULER_ENABLED=1` is set in the target GitHub environment.

Environment variables:

- `INSTITUTION_DIGEST_SCHEDULER_ENABLED`: Set to `1` to create or update the scheduler job.
- `INSTITUTION_DIGEST_SCHEDULER_JOB`: Optional job name. Defaults to `institution-digest-staging` or `institution-digest-production`.
- `INSTITUTION_DIGEST_SCHEDULER_SCHEDULE`: Optional cron schedule. Defaults to `0 9 * * *`.
- `INSTITUTION_DIGEST_SCHEDULER_LIMIT_USERS`: Optional batch user limit. Defaults to `50`.
- `INSTITUTION_DIGEST_SCHEDULER_LIMIT_ITEMS`: Optional per-user item limit. Defaults to `50`.
- `INSTITUTION_DIGEST_SCHEDULER_DRY_RUN`: Optional dry-run flag. Defaults to `true` in staging and `false` in production.

Keep staging enabled as a dry run until the run metrics look healthy. Enable production only after indexes are ready and a controlled live test user has passed.

## Data Model

Each run record includes:

- `userId`
- `dryRun`
- `cadence`
- `lastSentAt`
- `generatedAt`
- `readAt`
- `itemCount`
- `wouldSend`
- `status`
- `itemKeys`
- `items`
- `summary`

The summary stores counts for managers, tickers, new positions, increased positions, reduced positions, sold-out positions, unchanged rows, net value change, and gross value change.

## Indexes

Deploy `firestore.indexes.json` after this change. User digest history queries need:

- `institution_digest_runs`: `userId ASC`, `generatedAt DESC`
- `institution_digest_runs`: `userId ASC`, `dryRun ASC`, `readAt ASC`

See `docs/institution-digests-smoke.md` for the post-deploy index and smoke checklist.

## Retention

Dry runs are admin previews only and do not write digest run records. Only live checkpointed runs are persisted in `institution_digest_runs`.
