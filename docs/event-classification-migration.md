# Event classification migration

Routine news collection queries only `insiderEnrichmentPending == true`, regardless
of historical bootstrap completion. New disclosures already set this flag during
ingestion. No migration scan runs automatically in the news job.

Run the existing migration explicitly when needed:

```powershell
npx tsx scripts/backfill-event-classifications.ts --resume
npx tsx scripts/backfill-event-classifications.ts --apply --resume
```

The first command is read-only. Each invocation is bounded to five pages of 100
events and 90 seconds. Resume until complete; a completed migration version makes
subsequent `--resume` calls no-ops. Omitting `--resume` explicitly starts a fresh
scan. The default migration initializes classifications and insider pending flags
without calling SEC; `--enrich-insiders` explicitly enables provider enrichment.

Migration progress uses `migrationAfterEventId`, `migrationResult`, and
`migrationVersion` in the existing `collectors/event-classification-v1` document.
Its first resume falls back to the historical `bootstrapAfterEventId` cursor.
Scheduled work uses separate `pendingAfterEventId`, `pendingLastRunAt`, and
`pendingResult` fields, so it cannot advance or reset the migration cursor.

Deploy the routine change before resuming migration, allowing old news executions
to finish so the final legacy bootstrap position is available. Keep the website
and existing schedules running. Apply migration batches deliberately while
monitoring write fan-out and errors. Unmigrated historical events without pending
flags wait for this explicit migration; routine collection never falls back to a
broad scan. Existing pending-enrichment failure/retry behavior is unchanged.
