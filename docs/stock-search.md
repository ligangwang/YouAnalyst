# Company search

Explore, Companies and fullscreen charts share the same Search company / 搜索公司 dialog. Explore no longer renders a sidebar text field. A small magnifier button is available on desktop and mobile; Type to search / 输入即可搜索 is only its hover title. There is no permanent keyboard or language hint.

On Explore and Companies, ordinary text starts lookup with its first character preserved. On a fullscreen chart, that chart owns lookup. Arrows, Enter, Escape, Tab, function keys, Ctrl/Alt/Cmd combinations and editable controls do not launch it. IME composition focuses a real input without consuming composition keys. Suggestions support Chinese names, full pinyin, initials, English names and codes. Enter selects; Escape closes lookup while retaining fullscreen.

## Indexes

The existing companies collection stores names/aliases and generated searchTerms, searchPrefixes and searchIndexVersion. All Chinese names/aliases use the same pinyin conversion; no per-company pinyin shortcuts exist. The unified searchPrefixes array includes native names, aliases, compact names, codes, pinyin and initials, with up to 6,000 unique entries distributed across source terms so long legal names cannot consume the whole bound. Full terms are reserved for ranking; searchTerms is not queried.

The API queries only searchPrefixes and symbolLower. A scalar range on symbolLower preserves partial-code ranking when name matches fill the bounded candidate page. Exact codes are read separately. No directory scans occur while typing.

## Safe migration order

1. Preview scripts/migrate-company-search.ts --preview using GCP_PROJECT_ID and existing Google credentials.
2. Run --apply to populate the unified fields on all existing records. The old fields remain available to the current app. The explicit user-approved AMD alias 超微半导体 is appended without changing the canonical identity or any existing aliases.
3. Deploy the web app and all company-writing workers. Verify the public search version header and live Chinese/pinyin/initials/code searches.
4. Run --apply --cleanup --expected-sha <deployed SHA>. Cleanup verifies the live release/search version, both company-writing subscriber templates and their traffic revisions, the directory publisher and any running executions, and inactive import leases before removing symbolPrefixes, pinyinSearchPrefixes, pinyinSearchTerms and pinyinSearchVersion. Every write guards the document revision; reruns are idempotent.
5. Apply the companies fieldOverrides with FIRESTORE_APPLY_FIELD_OVERRIDES=1 and FIRESTORE_COLLECTION_GROUPS=companies. The regular index-maintenance command defers these exemptions so it cannot disable the old app's queries during rollout. Removed fields and the unqueried searchTerms/searchIndexVersion metadata are explicitly exempted from automatic indexing.

No new collections, LLM calls or provider requests are required. Names, IDs, slugs, listing data and prices are preserved.
