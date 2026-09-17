# Company posts and prediction migration

## User experience

Publish a company article with optional Bullish/Bearish direction; no watchlist selector.
Without a direction, publish research without opening a prediction. With the same direction
as an active call, append a dated article automatically. Preserve the original entry price,
entry date, horizon and performance. With an opposite direction, require an explicit
change-of-view flow; do not silently close or reverse an existing call.

My predictions lists existing calls across their former groups. Following stays separate.
Only the explicitly identified NVDA vs AMD group becomes a comparison. Show individual
returns, original entry dates and the percentage-point difference. Unequal entry dates
must be labeled, not normalized silently. Retain legacy URLs and ownership restrictions.

## Proposed collection: posts (approved by owner)

One document per article, including standalone research and prediction updates:

- `userId`, `companyId`, `ticker`: authenticated author and validated company identity.
- `title`, `body`: plain text with bounded lengths.
- `predictionId`: nullable reference to the author's prediction.
- `direction`: `UP`, `DOWN`, or null; direction at publication time.
- `visibility`: `PUBLIC` or `PRIVATE`, never broader than an attached prediction.
- `createdAt`, `updatedAt`: server timestamps; preserve publication history.
- `requestId`: author-scoped retry identity to prevent duplicate submissions.

All writes go through authenticated server handlers. Clients cannot choose another
author or attach to another author's prediction. Public reads enforce both article
visibility and author/profile/prediction visibility. Private reads require ownership.
Prediction creation and linked article publication must be atomic; retries must not
create multiple predictions or posts. Serialize against the existing user document.
Existing prediction thesis text remains readable without copying it into new posts.

No new comparison collection is proposed: retain the existing watchlists documents
for comparison membership and archived legacy metadata.

## Migration sequence

1. Read all groups and predictions; identify the confirmed comparison by document ID.
2. Produce a private dry-run report using `planPublishingMigration`. Stop on ownership
   mismatches or privacy discrepancies. Report duplicate active user/company calls;
   preserve them and let the owner select the primary call for future articles in My predictions.
3. Deploy compatible readers and publishing handlers before archiving grouping records.
4. In a checked, repeatable migration, mark the confirmed group as a comparison and
   archive other grouping records. Preserve all prediction documents and old IDs.
5. Keep legacy links readable, including archived groups. Remove create/move-group
   controls and enforce one active call across all creation paths, including AI calls.
6. Verify standalone publishing, same-direction append, opposite-direction handling,
   private access, retries, legacy links and comparison performance before release.

The owner approved the `posts` collection. The dry run found 30 predictions in nine
legacy groups, with one NVDA vs AMD comparison and two distinct active AMD calls.
`--apply-groups` archives only grouping metadata and leaves every prediction untouched.
A canceled HIMS call without a group remains unchanged. Full primary selection can be
performed in My predictions or supplied explicitly with `--primary=ID --apply`.
Migration snapshots contain private records and must remain in the uncommitted output folder.
