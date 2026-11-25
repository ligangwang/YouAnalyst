# Hierarchy browsers

- `/industries?taxonomy=SIC&code=3674` selects an industry. Codes are strings; leading zeros are preserved. CNI uses the same route with `taxonomy=CNI`.
- `/investment-themes?node=ai.chips` selects a theme node. `theme=ai` is also accepted for existing theme links.
- Both routes support `/en` and `/zh-cn`, search in either language, parent breadcrumbs, children, and invalid-link recovery.

Industries use the existing bilingual catalogs. Company results are explicitly limited to theme-enrolled companies, including descendants and deduplicating company IDs. Both legacy and code-only industry assignments work. Legacy theme assignments retain their existing specificity; the browser does not invent granular company memberships.

The website and editorial tools use the catalog shipped in `data/investment-themes/catalog-v1.json`. Each published node has a stable ID, a parent, bilingual names, order, and optional bilingual descriptions. Runtime validation checks the hierarchy before exposing the published nodes through `/api/investment-themes`.

The hierarchy contains families, investment themes, and nested business roles. The Explore sidebar starts with Transformative Technologies → AI → Energy / Chips / Infrastructure / Models / Applications. Stable IDs keep saved links and role filters compatible. Empty themes remain visible until companies are reviewed and enrolled.

Company data reuses the existing enrollment loader/local cache; a five-minute process cache shares the browsing projection. Company queries split theme IDs into batches of at most 30 and deduplicate companies. Families aggregate descendant memberships at read time; family memberships are not copied onto company documents.

## Publishing catalog changes

Submit coherent parent and child edits to the catalog in one pull request. Keep existing node IDs stable, and include English and Simplified Chinese descriptions where the taxonomy requires them. The release promotes the catalog with its matching application revision after candidate verification. Company memberships remain separate and can be edited through the company-theme editor. Legacy AI and historical Robotics and Space role encodings remain readable.
