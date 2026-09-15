# Company display name corrections

Signed-in administrators can select a company on the 3D map and use **Edit display name** in its details panel. The editor changes the current language (`en` or `zh-CN`). Ordinary visitors cannot use the endpoint.

`PATCH /api/admin/company-names` accepts a Firebase ID token in `Authorization: Bearer …` and a JSON body:

```json
{"companyId":"US:TSM","locale":"zh-CN","name":"台积电","expectedName":"台积公司"}
```

The server checks the existing admin role, validates the input, and updates only an existing published/directory company in a transaction. `expectedName` is the current localized field (empty string when absent). Stale edits return 409. Repeating an edit with an unchanged value performs no writes.

The canonical company ID, ticker, legal name, relationships and source evidence are preserved. Previous display names remain searchable aliases. The existing `companies` document records the latest edit per language (`nameEdits`) and rebuilds search prefixes. This is a latest-edit record, not a complete revision history.

A revision marker in the existing `directory_syncs/company_names` document invalidates in-process graph caches across servers. Graph responses bypass browser/CDN caching, while the expensive graph build remains cached until that revision changes or its five-minute TTL expires. The active graph updates immediately on save; other already-open views receive the new name when they reload or fetch their next update. No new Firestore collection is required.
