# Institution Digests

Institution digests are in-app snapshots for users who follow institutional managers. They do not send email. A generated run is saved in `institution_digest_runs` and appears in the user's Institutions page.

## User Flow

- Users enable digests from the Institutions page preferences panel.
- Generated live digest runs appear in the Institution digests panel.
- Users can open a run, group items by institution or ticker, follow SEC filing links, and mark live runs as read.
- Dry-run records are visible to admins and can also appear in user history, but they do not update the user's checkpoint.

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

## Retention

Dry runs are admin previews only and do not write digest run records. Only live checkpointed runs are persisted in `institution_digest_runs`.
