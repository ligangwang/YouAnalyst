# GitHub Actions and admin jobs

Routine job execution and history are available at `/admin/jobs`:

- US and China EOD maintenance: rerun a selected date and inspect results.
- SEC fundamentals, A-share financials and private valuations: run using
  the job's admin controls and inspect results.
- China company directory: inspect history; execution remains in Cloud Scheduler
  and Cloud Run, with no admin rerun button.

The remaining GitHub Actions serve these purposes:

| Workflow | Purpose |
| --- | --- |
| `deploy.yml` | PR verification, website builds and deployment |
| `deploy-sec-fundamentals.yml` | Deploy the SEC worker and schedule |
| `deploy-cn-fundamentals.yml` | Deploy the A-share worker and schedule |
| `deploy-private-valuations.yml` | Deploy the private valuation worker and schedule |
| `deploy-directory-sync.yml` | Update the directory worker and IAM |
| `ticker-sync-manual.yml` | Ticker catalog sync; no equivalent admin control |

Worker deployment updates the code used by admin jobs; it does not run the
maintenance job. Existing scheduler enabled/paused states remain unchanged by
this workflow cleanup.

## Retired launchers

The duplicate EOD launcher is removed. Admin reruns intentionally do not expose
its advanced recomputation, ticker overrides or cross-date roll-forward options.
Those operations remain in the authenticated internal EOD API for deliberate
maintenance; they have not been added to the admin UI.

The fixed-batch company identity review and six publication launchers (identities,
names, profiles, compute research, global research and relationship verification)
are removed, together with the A-share source probe launcher. Their underlying
scripts, reviewed data and tests remain available for maintenance. They are not
all equivalent to admin controls; routine company and industry research uses the
admin research pages. Reusing a retained publication script requires fresh review
of the batch, evidence and live preview before any write.

Workflow removals take effect in GitHub after merging to the default branch.
Historical workflow runs are retained.

AI analyst generation and its draft approval/rejection UI and APIs have been
retired. Historical published AI calls retain their identity labels, and existing
usage records remain available. Company and industry research review is separate
and remains supported.
