# Map-wide earnings collection

The published AI Map selects the production earnings universe, including all
US-listed and mainland China-listed companies. Adapter identity hints are not an
allowlist. Private companies and listings outside SEC/CNINFO scope are excluded.

The existing SEC scanner resolves each ticker against the official directory;
the same submissions response supplies financial filings, universal disclosure
events, and earnings discovery. SEC Item 2.02 current reports supply official
EX-99 exhibits. Foreign issuer 6-K exhibits remain candidates. Scanner identity
checkpoints in `collectors` bind queued sources to map companies; downloaded
documents cannot enroll an issuer or change its CIK.

The exchange map collector supplies earnings candidates from its existing
CNINFO pages for every mainland map company. `earningsCoverageVersion: 2` is
written only after complete pagination and durable earnings intake. Upgrading
from the earlier eight-company selection performs a one-time scan from January
1, 2026, without replacing universal events or their original timestamps.
The standalone earnings collector falls back per company when this complete
checkpoint is missing, stale, or partial, or the replacement is disabled.

SEC earnings discovery retains the existing bounded 180-day initial/reconcile
window and seven-day incremental overlap. Outbox publication, source retries,
provider cooldowns, pagination budgets and leases remain bounded. Additional
outbox work drains on later scheduled runs. No new Firestore collection is used.

Source capture is map-wide; numerical extraction requires a recognized layout
with verified issuer, period, units and column order. Common reviewed mainland
quarter/half-year layouts apply across map issuers. US release adapters cover
NVIDIA, AMD, Microsoft, Alibaba and Micron; other formats are retained as
`review_required`, rather than creating unverified figures. Micron's adapter
uses adjacent fiscal quarter ends, supports 14-week quarters, and cross-checks
consolidated statement revenue against its quarterly GAAP summary. It never
substitutes an annual column. Existing records and first-seen timestamps are
preserved. Collector coverage does not imply that every financial format has
been parsed or that every company has published a new report today.
