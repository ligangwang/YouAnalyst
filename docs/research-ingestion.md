# Research ingestion API

The authenticated API publishes relationship data without a PR or application deployment for each batch. Code, schema and validation changes still go through review. Initial scope is existing company endpoints and non-competition relationships; it does not create companies or accept arbitrary Firestore collection names.

## Publisher identity

Production requires all three runtime variables; unset variables disable the API:

- `RESEARCH_TOKEN_AUDIENCE`: `https://youanalyst.com`
- `RESEARCH_PUBLISHER_EMAIL`: `research-publisher@ifindata-80905.iam.gserviceaccount.com`
- `RESEARCH_PUBLISHER_SUB`: the immutable numeric ID of that service account

These are configuration, not secrets. GitHub repository variables supply them to the production deploy. Staging remains disabled unless explicitly configured. Google ID tokens are verified for signature, issuer, exact audience, expiry, maximum one-hour lifetime, verified email and exact subject. Firebase user tokens, internal shared tokens and browser sessions are not accepted. The publisher has no direct Firestore access through this setup; the application service identity performs the writes.

Remove/change the permitted subject to disable API access. Removing impersonation permission stops new token issuance but existing tokens can remain valid until expiry. Local gcloud login credentials must still be protected. No downloaded service-account key is needed.

## Local use (PowerShell)

After `gcloud auth login` and the one-time service-account impersonation grant:

```powershell
./scripts/research-api.ps1 -Mode Preview -File ./data/ai-supply-chain/compute-research.json
./scripts/research-api.ps1 -Mode Publish -File ./data/ai-supply-chain/compute-research.json
./scripts/research-api.ps1 -Mode Get -BatchId ai-compute-2026-09-15
```

Preview defaults to no relationship changes. Publish explicitly requests a preview then commits that exact version; it does not require an interactive confirmation. The script obtains a fresh ID token for each request and discards it afterward. It never writes tokens to disk or prints them and refuses redirects. No repository file change is necessary: `-File` may point to any reviewed local batch JSON.

## Endpoints

All requests require `Authorization: Bearer <Google ID token>`. Responses are `no-store`.

- `POST /api/admin/research/preview`: JSON matching `ComputeBatch` in `src/lib/research/publisher.ts` (example: `data/ai-supply-chain/compute-research.json`). Saves a 15-minute preview and returns `id`, `previewToken`, proposed changes and counts.
- `POST /api/admin/research/publish`: `{ "batchId": "...", "previewToken": "..." }`. Reads the server-side batch, verifies current database state, atomically writes relationships and the publication receipt.
- `GET /api/admin/research/batches/:id`: returns the result, submitted batch and before/after audit records to the permitted batch owner.

Use a new `batchId` for different content. Retrying a successful publish returns the original receipt without performing any writes. Repeating preview with identical content reuses its unexpired version. An expired preview can be refreshed with the same payload. If relationship data changes during its lifetime, use a newly named reviewed batch or refresh after expiry; a stale version is never published silently.

## Data guarantees and limits

`research_batches` is the user-approved, server-only audit collection. Before-images, exact submitted data, caller identity, preview version and resulting changes are retained there. The original `company_relationships` collection remains the data source for `/api/knowledge-graph`. Existing client Firestore rules grant no access to `research_batches`; Admin SDK authorization is enforced by these API routes.

Each batch allows at most 100 edges, 200 sources and 20 facts per edge. HTTP input is limited to 180 KB; audit records are limited to 700 KB. Split larger submissions. An instance-local throttle allows 30 authenticated requests per minute; it is not a fleet-wide quota. No index/TTL setup is required. API writes do not bypass identity, status or duplicate checks: missing companies, duplicate legacy records and non-public editorial states fail the entire transaction.

New evidence is merged by URL. Symmetric relationships sort endpoint IDs, and customer descriptions normalize to supplier direction. Product facts keep documented versus announced states, source dates and limitations. Source metadata and factual truth still require research review; schema validation cannot prove a claim is true.

The stored before-images support an operator-reviewed rollback. There is no automatic rollback endpoint: restoring an old snapshot over newer edits would require checking those edits first. Audit records can be read through the GET endpoint for that comparison. Graph caches can take up to several minutes to reflect publication.
