# AI compute research publication — 2026-09-15

Scope: AMD, NVIDIA, Intel, Broadcom and Marvell. This is the first curated relationship batch, not an exhaustive supplier inventory or investment assessment.

`compute-research.json` contains 29 distinct non-competition relationships and 38 scoped facts. Against the September 15 public API snapshot, 25 were additions and four enriched existing records. Publication rechecks Firestore; these are preview estimates, not a record of completed publication.

## Editorial decisions

- No competition edges. Sector overlap remains research context and does not imply direct competition.
- All endpoints in this batch already exist in the public graph. No new companies or Firestore collections are created.
- GPU adoption, EPYC CPU use, custom ASIC development and networking are separately described. Do not infer GPU purchases from CPU deployments.
- DOCUMENTED means the cited source describes an existing fact at its date, not verified continuous operation today. ANNOUNCED facts retain their prospective character even after the projected date passes.
- Same endpoints and symmetric type share a canonical key. Customer/supplier inverse descriptions normalize to supplier direction. Different meaningful relationship types remain distinct.
- Marvell–NVIDIA and Anthropic–Broadcom already existed: enrich those records. AMD–Intel x86 advisory cooperation is not a competition edge. Meta–Broadcom co-design and Tomahawk system integration are different product facts/types.
- Preserve existing editorial status and published facts. Conflicting or withdrawn records fail publication for review; they are never silently republished.
- The public API currently exposes relationship summaries and source links. Additional per-fact state, scope, limitations and sources are stored in `researchFacts`; dated status labels are also added to the public summary.

## Deferred identity research

Samsung Electronics, UMC, SPIL, KYEC, Sanmina, Tongfu ATMP joint ventures, HUMAIN, Cerebras, Hugging Face, Red Hat, Cohere and IBM require matching against the broader company directory before proposing new nodes. Do not equate a joint venture with its listed parent or Red Hat technology with IBM chip procurement. These candidates are not included in this batch's 29 edges.

## Operation

Run `npx tsx --test tests/compute-research.test.ts` and `npx tsx scripts/publish-compute-research.ts --validate` locally. The main-only **Publish reviewed AI compute research** workflow authenticates using the existing production identity and collection permissions.

The workflow previews all changes, uploads the complete affected relationship before-images, writes in one transaction only if the preview still matches, then checks that another run proposes zero changes. Repeated runs merge sources by URL and facts by content/source URLs. Preview/write/verify JSON artifacts provide the actual outcome. Restore only reviewed affected documents from the before-images if rollback is needed; never rerun a broad seed import as rollback.

Refresh `/api/knowledge-graph` after its five-minute in-process and HTTP caches expire and check all candidate pairs, status labels and evidence links. No application redeployment is required for these database records.
