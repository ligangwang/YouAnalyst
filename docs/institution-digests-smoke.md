# Institution Digest Smoke Checklist

Use this checklist after deploying institution digest changes to staging or production.

## Firestore Indexes

Apply composite indexes before running smoke checks:

```bash
GOOGLE_CLOUD_PROJECT=ifindata-80905 npm run firestore:indexes:apply
```

Wait until the `institution_digest_runs` indexes are ready:

- `userId ASC`, `generatedAt DESC`
- `userId ASC`, `dryRun ASC`, `readAt ASC`

## Optional Playwright Smoke

The default smoke suite remains unauthenticated. To run the institution digest smoke checks, provide these environment variables:

```bash
PLAYWRIGHT_BASE_URL=https://your-deployed-url \
PLAYWRIGHT_ADMIN_AUTH_BEARER_TOKEN=<admin-firebase-id-token> \
PLAYWRIGHT_USER_AUTH_BEARER_TOKEN=<test-user-firebase-id-token> \
PLAYWRIGHT_INSTITUTION_DIGEST_USER_ID=<test-user-id> \
PLAYWRIGHT_INSTITUTION_CIK=<known-manager-cik> \
npm run smoke:test -- --grep "institution"
```

These checks verify:

- Admin dry runs return preview results without persisted `runId` values.
- User digest history returns an `items` array and best-effort `unreadCount`.
- Institution follow management can follow, list, and unfollow a known manager for the test user.

## Manual Smoke

1. Open `/admin/institutions/digests`.
2. Run a dry run for one explicit user ID and confirm no digest record is created.
3. Run a live checkpoint for that same user ID.
4. Sign in as the user and open `/institutions`.
5. Confirm the digest appears, the unread badge is visible, and Mark read clears the unread state.
6. Follow a manager from the discovery cards.
7. Search, sort, and unfollow from the Followed institutions panel.
8. Refresh Followed institution activity and confirm stale data does not remain after errors.
