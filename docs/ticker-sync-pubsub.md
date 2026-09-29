# Background ticker catalog sync

Admin Preview still fetches the provider catalog and returns a sample without
writing catalog records. Sync now persists a request and publishes it to
`ticker-catalog-requests`, returning HTTP 202 only after publication is confirmed.
The confirmation means queued, not completed; the page can be closed. The internal
sync endpoint uses the same path for writes, with preview remaining its default.

`ticker-catalog-worker` pushes to the private `ticker-catalog-subscriber` Cloud Run
service using the existing scheduler identity. The shared maintenance runtime
processes requests with one instance and concurrency one. The service is built
into the shared maintenance image; `deploy-background-jobs.sh all`, `fundamentals`,
or `ticker-sync` provisions it. It has no schedule or separate publisher job.
The web runtime gets publisher permission on the request topic only.

No new Firestore collection is used. The existing `directory_syncs` collection holds:

- `TICKER_CATALOG`: execution lease, active request, dispatch throttle, and last result.
- `_ticker_<requestId>`: original request, progress, and completion result.
- `_ticker_<requestId>_page_<page>`: immutable catalog pages after preparation completes.

One active import is allowed. Retrying with identical options after the 30-second
dispatch throttle republishes the original request, including after an ambiguous
publish failure. Different options are rejected until the active import finishes.
The 30-minute execution lease blocks overlap with previews and existing direct
workers. A crashed delivery becomes available again when that lease expires.

The worker fetches and normalizes the provider catalog once, then persists bounded
pages before writing listings. Incomplete preparation may refetch on retry; after
preparation, retries always use the saved snapshot. Each transaction commits up
to 100 ticker records, their selected company listings, and the progress checkpoint
together. The preferred exchange is selected across the entire snapshot. Company
transactions read current translations and aliases so reviewed fields and search
names are preserved. Completed deliveries acknowledge without writing again.

Each attempt has a seven-minute processing budget and leaves one minute before
starting another page. Incomplete work or failures return 503 for retry; success
returns 204. Delivery retries are configured for 300–600 seconds. Persistent
failures go to `ticker-catalog-dead-letter` after approximately 100 attempts, with
the `ticker-catalog-dead-letter-audit` pull subscription retaining them for seven
days. The request subscription also retains messages for seven days.

`/admin/jobs` → Ticker catalog shows preview and subscriber runs through the existing
`sync-tickers` logs. Correlate subscriber attempts using batchId. Publisher acceptance
is displayed in the admin response; processing history starts when delivery starts.
A failed delivery may later finish successfully, with cumulative written/batch
counts in its terminal log.

Deployment passes `TWELVE_DATA_API_KEY` and `TWELVE_DATA_API_URL` from the existing
production workflow configuration through a private temporary environment file.
It reuses the SEC push identity's token-creation binding; initial bootstrap uses
the explicit `PUBSUB_BOOTSTRAP_IAM=1` switch. Local tests do not verify live IAM or
provider access. After deployment, preview and queue a small limited import, then
confirm completion in subscriber logs before a full import.

If publication failed during rollout, retry the same options after provisioning
finishes. For a stalled or dead-lettered import, fix the cause and republish the
original message unchanged, or submit the same options again. Snapshots and ledgers
are retained for recovery. Do not clear active state while an import is unfinished;
doing so would allow a new import to overlap an old replay.

For rollback, pause push delivery by switching the subscription to pull mode, allow
any active execution to finish or expire, and restore the prior web revision for
synchronous imports. Preserve topics and checkpoints for recovery.
