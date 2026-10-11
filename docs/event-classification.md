# Event classification and migration

Existing `events` documents receive `eventType`, `eventSubtype`, and `eventClassification` (version, method, rule, evidence). Broad `category` values remain compatible. No new collections or AI requests are introduced.

Types: earnings (results, scheduled, guidance, periodic reports); insider trades (buy, sell, award, exercise, withholding, gift, planned sale, ownership); relationships (new, expanded, terminated, disclosed); products/business; corporate actions; financing; regulatory/governance; other.

Headline rules require explicit language. SEC Form 4 alone means ownership disclosure, never an inferred purchase/sale. Official ownership XML supplies transaction codes P/S/A/M/F/G and validated reporting owner, security, transaction date, shares and direction. Unsupported or incomplete XML remains ownership disclosure. Source publication dates, transaction dates, collected/processed times remain distinct.

Insider facets are persisted on their existing source document in `insiderEventGroups`, with a strong grouping key: company, sorted reporting-owner identities, transaction date, subtype, normalized security and derivative flag. Matching facets merge at projection time and retain every reference URL. Different insiders, securities, dates and buy/sell types remain separate. Amendments update details while retaining the first publication date and original references. Exact matching company-news announcements retain the existing conservative grouping rules.

The hourly news worker backfills a bounded batch, resumes through `collectors/event-classification-v1`, and retries unresolved ownership reads on later scans. No original content or source timestamps are overwritten. Documents with newer classification versions are skipped; transactions recheck original source identity before writing.

Manual migration uses the existing maintenance image and existing news worker service account:

- Preview: `node dist/backfill-event-classifications.cjs`
- Apply metadata: `node dist/backfill-event-classifications.cjs --apply`
- Enrich transactions: add `--enrich-insiders` (requires existing SEC_USER_AGENT).
- Continue bounded runs: add `--resume` until the result reports complete.

Preview does not write checkpoints. Apply updates only classification fields in existing documents and its checkpoint. Monitor `failed` separately: failed XML reads retain conservative classification and do not fabricate trade details. Symbols remain clickable; the existing company card opens event details at the top, including subtype, transaction details, original reference links and stock return when available.
