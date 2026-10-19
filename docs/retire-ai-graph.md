# Retired companies.aiGraph tooling

The one-time legacy `aiGraph` cleanup runner has been retired. The original implementation and procedure remain in Git history. Removing the tool does not delete Firestore fields or change live indexes. `inGraph` layout metadata and published theme memberships remain supported.

## Retire the redundant inGraph.status query

The production comparison on 2026-10-18 found 178 theme-query companies and three
published inGraph companies, all already in the theme set. Enrollment and news
source queries now use only themeIds. The graph loader also queries themeIds and
checks inGraph.status in memory to retain its existing layout behavior. Keep the
inGraph data; only its status index is retired. All future graph enrollment must
include a supported themeId to be discoverable.

The field exemptions now also disable companies.inGraph.status. Apply them only
after all old query callers have been replaced. Preserve legacy layout metadata if restoring historical company records; this cleanup does not perform a production data conversion.
