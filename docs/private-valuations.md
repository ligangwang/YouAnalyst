# Private valuation source checks

The **Private company valuations** entry in `/admin/jobs` offers a manual **Run private valuation check now** button. It runs independently of SEC and A-share jobs, with its own lease and admin-only dispatch. Monthly Cloud Scheduler execution is at 09:00 America/New_York on day 1.

The main production release workflow automatically deploys this worker when its code or shared dependencies change. The workflow builds the shared maintenance image, creates the worker, grants the existing scheduler and web identities invocation access, and creates the monthly schedule enabled. Existing schedules retain their paused/enabled state. Deployment itself does not execute the worker.

Local commands (ADC and `GCP_PROJECT_ID` required except for sources-only):

```
npx tsx scripts/refresh-private-valuations.ts --dry-run --sources-only
npx tsx scripts/refresh-private-valuations.ts --dry-run
npx tsx scripts/refresh-private-valuations.ts
```

The worker selects private companies with published `inGraph` membership (legacy `aiGraph` fallback). It stores each result in the existing `companies/{id}.privateValuationCheck` field and its lease/summary in `company_fundamentals/_private_valuation_worker`. No new collections or public market-cap fields are used.

Reviewed sources initially cover Anthropic, OpenAI, and Mistral AI. Other companies report `unsupported` for source onboarding. Each run verifies the reviewed announcement passage and scans the official news index or RSS for financing links. New links are **review candidates**, not automatically trusted amounts: they can include earlier rounds or proposed transactions. Review their publication dates, completed transaction status, currency and valuation basis before updating the registry. HTML discovery only covers the currently linked news page; it is not an exhaustive archive or web search.

Statuses: `verified`, `review_required`, `stale`, `unsupported`. Network/index failures count as `failed` and fail the execution. OpenAI currently blocks direct automated article retrieval; its accessible official RSS supports discovery, but cannot reverify the valuation amount. That condition remains `review_required`. When the official RSS contains the exact reviewed announcement URL and financing date, the worker retains the reviewed amount with `verification: reviewed`; it never claims a fresh source verification. A readable but changed article does not get this fallback. Check **Errors & warnings** and company-level run logs for source URLs and reasons even when the execution succeeds.

Private valuations retain original currency, date, post-money basis, URL, review date and exact/greater-than qualifier. Age is measured from the financing date, never the check date, with a 365-day limit. Rechecking does not renew it. The graph API projects validated saved results into `privateValuation`. The company table and detail panels label these as private post-money valuations with their original currency, financing date, and source link. OpenAI explicitly shows its review date and unavailable automated recheck. EUR is not converted to USD; table value sorting continues to order public USD market caps with private companies last. Records over 365 days old are hidden at read time. After deploying both web and worker updates, run the job once to populate the reviewed fallback; graph caches can take five minutes to refresh.

Initial evidence: Anthropic Series H (2026-05-28, USD965B), OpenAI funding close (2026-03-31, USD852B), Mistral Series D (2026-09-08, greater than EUR21B). Official announcement links are in `src/lib/fundamentals/private-valuations.ts`; Mistral's announcement date is also documented at https://www.lemonde.fr/en/economy/article/2026/09/08/mistral-ai-raises-3-billion-in-response-to-doubts-over-its-strategic-direction_6757278_19.html.
