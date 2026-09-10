# Interface language and market preferences

Interface language (`en`, `zh-CN`) is independent of market (`US`, `CN_A`, `ALL`). The header exposes both controls; the owner's profile also exposes account settings. Visitors retain preferences in cookies. Signed-in changes save both fields to the authenticated user's `displayPreferences`, then navigate with explicit query parameters. Account preferences restore when neither query parameter overrides them. Failed saves retain the current page and show a retry message.

The proxy validates query parameters and cookies and overwrites request preference headers. The preferences endpoint requires a verified token, derives the document ID from that token, validates allowed values, and returns private, non-cacheable responses.

Use `UiText` for authored UI copy and `useUiText` for string attributes in client components. The Chinese catalogs include static labels and bounded templates for counts, errors, and accessibility text. Existing bilingual components can continue using the locale provider's `text(en, zh)` helper. Never pass user-authored names, titles, posts, comments, or original filing excerpts through UI translation. Company identifiers and financial acronyms remain unchanged. Source material and generated share-card images retain their original language.

The coverage test checks static JSX labels and literal `UiText` entries. It cannot prove coverage of every runtime API message; new UI branches, interpolated copy and error states still need review. Browser tests cover Chinese/English calls, author-content preservation, independent market switching, failed account saves, and restoring saved preferences.

Market selection reflects available coverage: A-share discovery uses the curated AI supply chain. A-share live events, prices, and calls are not connected yet, and those discovery pages show an explicit coverage state. All markets includes both research landscapes and identifies the currently US-only event/price/call coverage. Existing records retain their identity and market; changing preferences never moves or changes calls or watchlists.
