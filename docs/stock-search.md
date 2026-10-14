# Stock lookup

Fullscreen price charts accept direct typing. Chinese names, English names, ticker/code, full pinyin and pinyin initials use the existing indexed `/api/tickers/search?scope=all` API. The lookup retains the first character, supports arrow selection/Enter, and Escape closes only the lookup. IME composition keys are not consumed; editable controls such as MA parameters are excluded.

Selecting a result switches the fullscreen chart without remounting it, preserving range, intervals and indicators. The chart heading identifies the selected stock; unavailable stored history is shown explicitly. Restoring the layout after switching opens that company's research page with the chart settings, so the surrounding company page does not contradict the chart.

`companyFields` maintains `pinyinSearchTerms`, bounded `pinyinSearchPrefixes` and `pinyinSearchVersion` in existing `companies` records. Search uses bounded indexed queries, not a full directory scan per keystroke. Pinyin matches are search suggestions only; they never merge identities or create legal-name aliases.

For existing records run `GCP_PROJECT_ID=... npx tsx scripts/backfill-pinyin-search.ts --preview`, then `--apply`. The migration pages the existing collection, changes only pinyin fields, uses document revision preconditions, and makes no LLM calls. Deployment must include this backfill before claiming pinyin works throughout the existing directory.
