# Earnings calendar

`/calendar` (localized `/en/calendar` and `/zh-cn/calendar`) reads confirmed schedules from the existing `events` collection. It offers month/week views, a day agenda, theme/company filters and account following. Exact times are displayed in Eastern Time; date-only and unzoned times retain the original announcement's precision.

Results releases and calls for the same company, fiscal period and displayed day share one earnings card and count as one calendar event. The card keeps separate results/call timing and status, and links to every distinct original announcement. Different dates or fiscal periods remain separate cards. Stored schedules retain their independent identities so a release or call can be updated or cancelled independently.

The existing `collect-intelligence-news-production` job checks issuer IR and Chinese exchange announcements across the unique union of published AI, Robotics and Space companies. Its existing weekday hourly schedule is retained. Articles without an approved configured source or an original publication date cannot enter extraction. Missing sources are not estimated earnings dates.

## Extraction and storage

- Title/summary keywords identify possible earnings schedules. Approved original HTML or CNInfo PDF content is fetched before extraction.
- `OPENAI_CALENDAR_MODEL=gpt-6-luna` selects the Responses API model, independently of other OpenAI features. `CALENDAR_EXTRACTION_ENABLED=1` enables this step. The existing production key is reused through the deployment's private temporary environment file.
- Structured output separates results releases from earnings calls/webcasts. Literal source quotations validate fiscal periods, dates, times and time zones. Unsupported output is withheld for review. Source publication, collection and processing timestamps are preserved separately from scheduled time.
- `events` documents with `type=scheduled_event` use company + fiscal period + activity kind as their stable identity, allowing rescheduling/cancellation without duplicate calendar entries. Older announcements cannot overwrite a newer announcement.
- `events` documents with `type=calendar_extraction` cache one provider request per canonical URL + normalized article hash. An atomic reservation prevents overlapping jobs from paying twice. Recent/future announcements are checked daily for content revisions; unchanged documents reuse the cached result. Completed historical documents are not polled indefinitely.
- Persistence retries reuse the returned response, never repeat the provider request. A request left in `requesting` after a crash is uncertain and is not automatically retried. Inspect the receipt and provider request history before any operator recovery.
- The existing `collectors/earnings-calendar` document records the history cursor, scan outcomes and coverage status. History scanning resumes across runs; current announcements are prioritized. At most 25 provider requests are admitted per run, within the existing job deadline.

## Cost reporting

The existing `openai_usage_events` ledger records returned token usage under `earnings_calendar_extraction`, including requests whose output failed validation. Failed requests without returned usage have unknown cost, rather than a zero-cost estimate. Model rates are estimated USD per million tokens: Luna input 0.10, cached input 0.01, output 0.50; environment rate overrides remain supported.

`/admin/openai-usage` shows complete calendar totals for the last 30 days and current UTC quarter, independently of its recent table limit, with unknown-cost counts and validation errors. Cache hits do not create usage entries.

The calendar date-range query uses scheduled dates, includes boundary days for source-time-zone conversion, and reports truncation if its 1,000-event safety limit is reached. No forecast data or fabricated dates are added to fill empty days.
