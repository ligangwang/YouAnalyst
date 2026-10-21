# Hierarchy browsers

- `/industries?taxonomy=SIC&code=3674` selects an industry. Codes are strings; leading zeros are preserved. CNI uses the same route with `taxonomy=CNI`.
- `/investment-themes?node=ai.chips` selects a theme node. `theme=ai` is also accepted for root links.
- Both routes support `/en` and `/zh-cn`, search in either language, parent breadcrumbs, children, and invalid-link recovery.

Industries use the existing bilingual catalogs. Company results are explicitly limited to theme-enrolled companies, including descendants and deduplicating company IDs. Both legacy and code-only industry assignments work. Legacy theme assignments retain their existing specificity; the browser does not invent granular company memberships.

Investment theme definitions read the approved `investment_themes` collection. Expected published document shape is `{status: "PUBLISHED", parentId: string | null, names: {en, "zh-CN"}, order: number, descriptions?: {en, "zh-CN"}, isDeleted?: boolean}`; the document ID is the stable node ID. Names, parents, ordering, and descriptions are validated before replacing the cached catalog. Publish coherent parent/child edits atomically. Reads are shared across concurrent requests and cached for 60 seconds per process. No admin editor, publication writes, or Cloud Storage snapshot publisher is introduced by these pages.

Until published records exist, the browser uses the current graph stages under the five AI layers and existing Robotics/Space sectors. On invalid data or read failure, the last valid catalog remains available. The larger proposed taxonomy is not automatically populated or assigned to companies.

Company data reuses the existing enrollment loader/local cache; a five-minute process cache shares the browsing projection. No classification migration or production deployment is needed to preview these pages locally.
