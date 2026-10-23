# Hierarchy browsers

- `/industries?taxonomy=SIC&code=3674` selects an industry. Codes are strings; leading zeros are preserved. CNI uses the same route with `taxonomy=CNI`.
- `/investment-themes?node=ai.chips` selects a theme node. `theme=ai` is also accepted for existing theme links.
- Both routes support `/en` and `/zh-cn`, search in either language, parent breadcrumbs, children, and invalid-link recovery.

Industries use the existing bilingual catalogs. Company results are explicitly limited to theme-enrolled companies, including descendants and deduplicating company IDs. Both legacy and code-only industry assignments work. Legacy theme assignments retain their existing specificity; the browser does not invent granular company memberships.

Investment theme definitions read the approved `investment_themes` collection. Expected published document shape is `{status: "PUBLISHED", parentId: string | null, names: {en, "zh-CN"}, order: number, descriptions?: {en, "zh-CN"}, isDeleted?: boolean}`; the document ID is the stable node ID. Names, parents, ordering, and descriptions are validated before replacing the cached catalog. Publish coherent parent/child edits atomically. Reads are shared across concurrent requests and cached for 60 seconds per process. The public `/api/investment-themes` endpoint exposes only this validated published catalog. A shared browser cache refreshes visible selectors every minute. Drafts are never exposed.

The hierarchy has three conceptual levels: family (root), investment theme (child of a family), and arbitrarily nested business roles. IDs are stable; `parentId` controls placement. There is no runtime hardcoded theme catalog. Cold failures report unavailable; refresh failures retain the last validated catalog. A new theme needs only published Firestore records and separately reviewed company memberships, with no code allowlist changes. Empty themes remain empty until companies are reviewed.

The Explore sidebar starts with a family selector, then a theme selector limited to that family. Its initial AI view is Transformative Technologies → AI → Energy / Chips / Infrastructure / Models / Applications → business roles → companies. The five AI layer IDs and role filter IDs remain compatible with saved links; definitions and ordering come from Firestore. Empty AI layers remain visible. Changing family selects its first published theme; no company membership is inferred from a family selection.

Company data reuses the existing enrollment loader/local cache; a five-minute process cache shares the browsing projection. Company queries split theme IDs into batches of at most 30 and deduplicate companies. Families aggregate descendant memberships at read time; family memberships are not copied onto company documents.

## Four-family catalog publication

`data/investment-themes/catalog-v1.json` is the reviewed initial publication input, not a runtime fallback. It defines Transformative Technologies; Environment & Resources; Health & Healthcare; and Society & Lifestyle, with 16 themes and the existing AI/Robotics/Space role nodes. The version and methodology are kept in Git; no new Firestore fields or collections are required.

Run `GOOGLE_CLOUD_PROJECT=<project> npx tsx scripts/publish-investment-themes.ts` for a read-only preview and backup. Add `--write` to publish. The command creates missing catalog nodes, fills absent bilingual descriptions, and reparents the existing `ai`, `robotics`, and `space` roots to `transformative-technologies`. It preserves IDs, names, existing descriptions, ordering, editorial decisions, and all company memberships. A bounded atomic commit uses update-time/create preconditions and verifies idempotence afterwards. Existing documents receive only the changed parent/description fields. It never writes `companies` or creates a new collection. Backups include original catalog documents. Conflicting parents or withdrawn records stop publication.

Every initial family, investment theme and AI layer has English and Simplified Chinese descriptions. When descriptions are present, validation requires nonempty strings in both languages. The theme browser renders only the active language; missing role descriptions do not fall back to English prose.

Publish the coherent catalog before validating a replacement website candidate. Keep the serving revision online throughout, validate the candidate against the published catalog, and promote only after verification. No bulk company backfill, scheduler interruption, or new indexes are required. Legacy AI `inGraph` and historical Robotics/Space role encodings remain compatibility adapters; they do not constrain newly published themes.

Future catalog changes should use coherent atomic parent/child edits, retaining immutable node IDs. To enroll companies, `scripts/enroll-theme-companies.ts` validates the theme and business roles against the current Firestore catalog and preserves unrelated existing memberships. Company membership sources and review status remain authoritative.
