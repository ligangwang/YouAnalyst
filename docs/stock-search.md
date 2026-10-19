# Company search

Explore, Companies and fullscreen charts share the same Search company / 搜索公司 dialog. Explore no longer renders a sidebar text field. A small magnifier button is available on desktop and mobile; Type to search / 输入即可搜索 is only its hover title. There is no permanent keyboard or language hint.

On Explore and Companies, ordinary text starts lookup with its first character preserved. On a fullscreen chart, that chart owns lookup. Arrows, Enter, Escape, Tab, function keys, Ctrl/Alt/Cmd combinations and editable controls do not launch it. IME composition focuses a real input without consuming composition keys. Suggestions support Chinese names, full pinyin, initials, English names and codes. Enter selects (or waits for the pending best match); editing or dismissing cancels that pending selection. Escape closes lookup while retaining fullscreen.

## Indexes

The existing companies collection stores names/aliases and generated searchTerms, searchPrefixes and searchIndexVersion. All Chinese names/aliases use the same pinyin conversion; no per-company pinyin shortcuts exist. The unified searchPrefixes array includes native names, aliases, compact names, codes, pinyin and initials, with up to 6,000 unique entries distributed across source terms so long legal names cannot consume the whole bound. Full terms are reserved for ranking; searchTerms is not queried.

The API queries only searchPrefixes and symbolLower. A scalar range on symbolLower preserves partial-code ranking when name matches fill the bounded candidate page. Exact codes are read separately. No directory scans occur while typing.

## Maintenance

The one-time unified-search and pinyin compatibility migration commands have been retired. Current company writers generate the unified search fields when creating or updating profiles. Preserve the runtime search indexing and validation logic.

Search field exemptions remain in `firestore.indexes.json`. Index changes use the existing index-maintenance tooling and require review of the deployed readers and writers before applying exemptions.
