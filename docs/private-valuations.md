# Private valuations

Private valuation background jobs are retired. The admin job list and Run now
endpoint, monthly publisher, Pub/Sub subscriber, deployment scripts, and worker
image entry points have been removed. Routine releases no longer deploy them.

Saved companies/{id}.privateValuationCheck records and private valuation display
remain. The reviewed source configuration still validates saved valuations when
the graph is read; the original financing date determines the 365-day expiry.
Removing the jobs does not refresh or delete saved valuations.

## Existing production resources

The scheduler, publisher job, delivery subscription and subscriber service below
were removed from `ifindata-80905` in `us-central1` on 2026-10-14. The removal order
is retained for any other deployment still running these jobs.

Repository changes alone do not remove already deployed resources. In the
YouAnalyst production project and region, retire these resources in order:

1. Delete the Cloud Scheduler job refresh-private-valuations-production.
2. Check for active executions of the Cloud Run Job
   refresh-private-valuations-production and allow them to finish.
3. Delete that Cloud Run Job and the Pub/Sub delivery subscription
   private-valuations-worker.
4. Delete the Cloud Run service private-valuations-subscriber.

Keep the request/dead-letter topics, audit subscription, logs, and Firestore
records for historical inspection. Shared maintenance service accounts and
other jobs remain in use.
