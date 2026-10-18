# Retire companies.aiGraph

Local changes remove the legacy query and runtime fallback. `inGraph` is the
canonical graph enrollment field; published theme memberships remain supported.
Firestore has fields rather than SQL columns. Existing documents need cleanup;
editing the TypeScript model does not remove stored fields.

Before rollout, back up companies and set `GCP_PROJECT_ID`. Preview with
`npx tsx scripts/retire-ai-graph.ts`. This one-time paginated company scan has a
read cost, but does not depend on the index being retired.

Pause company writers, then run
`npx tsx scripts/retire-ai-graph.ts --apply --writers-paused`.
The acknowledgement flag does not pause writers itself. Each transaction copies
legacy-only metadata to `inGraph` and deletes the complete `aiGraph` field.
Existing canonical metadata, including negative enrollment decisions, wins.
Unrelated company fields are preserved. Rerunning is safe after partial failure.

Deploy all updated readers/scripts and retire old instances before resuming
writers. Verify company coverage and rerun preview to confirm no legacy fields.
Only then apply the companies field exemptions from `firestore.indexes.json`
using the existing index tool with `FIRESTORE_APPLY_FIELD_OVERRIDES=1` and
`FIRESTORE_COLLECTION_GROUPS=companies`. This includes previously staged company
search exemptions; review all overrides before running. No aiGraph composite
index is declared locally. Inspect live composite indexes separately at rollout.

No production cleanup or index update has been performed by these local edits.

## Retire the redundant inGraph.status query

The production comparison on 2026-10-18 found 178 theme-query companies and three
published inGraph companies, all already in the theme set. Enrollment and news
source queries now use only themeIds. The graph loader also queries themeIds and
checks inGraph.status in memory to retain its existing layout behavior. Keep the
inGraph data; only its status index is retired. All future graph enrollment must
include a supported themeId to be discoverable.

The field exemptions now also disable companies.inGraph.status. Apply them only
after all old query callers have been replaced. The earlier aiGraph migration is
still required to preserve legacy layout metadata before the combined rollout.
