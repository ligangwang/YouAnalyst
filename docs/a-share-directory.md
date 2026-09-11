# A-share company publishing

Admin → Industry research → Research market: China A-shares → choose sector and industry (or custom scope) → Research industry → review individual companies and source links → Publish reviewed companies.

Research uses the existing OpenAI configuration and shares the global limit of three batches per UTC day with US research. A-share runs publish company profiles, not inferred commercial relationships. Sources must appear in the provider's search provenance; administrators still verify issuer identity, listing and business relevance. The taxonomy describes research topics, not official company classifications.

`market_companies/{exchange}:{code}` stores Chinese profiles with `market: CN_A` and `status: PUBLISHED`. Shanghai and Shenzhen A-shares are supported. Drafts stay in private `industry_research_runs`; US research retains its existing collection and listing checks. Firestore's default deny prevents direct client reads/writes; the public API exposes only approved profile fields. Publication and import require verified admin authentication.

Deployments run `scripts/seed-china-companies.ts` before switching traffic, using application-default credentials and `GCP_PROJECT_ID`. It creates only missing entries for the original five companies. The admin import button provides the same idempotent operation. Existing edits, reports and archived records are preserved. Discovery adds research-topic provenance to existing profiles without replacing editorial content.

The A-share landscape and A-share company directory read `/api/market-companies`, following document-ID cursors in batches of 100. No static company fallback hides Firestore outages. Loading, retry and empty states are localized. Published profiles appear on the next page load without deployment. This does not enable A-share prices, stock calls or US ticker detail pages.

A-share batches generate at most five Chinese-only profiles with low reasoning effort, at most four tool calls and the existing 12,000-token cap. English interface users also see Chinese company content. Legacy English fields may remain stored but are not required or displayed. Terminal failed runs cannot resume; start a new batch explicitly (subject to the shared daily limit).
