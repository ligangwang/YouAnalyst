#!/usr/bin/env bash
set -euo pipefail
bucket="${ENTITY_SNAPSHOT_BUCKET:-${EODHD_BULK_EOD_BUCKET:?Set the financial worker bucket}}"
prefix="gs://$bucket/worker-state/v1/fundamentals"
gcloud storage cat "$prefix/handoff.json" | node -e '
  const fs=require("node:fs"),assert=require("node:assert/strict");
  const proof=JSON.parse(fs.readFileSync(0,"utf8"));
  assert.equal(proof.version,1);assert.equal(proof.bucket,process.argv[1]);
  for(const kind of ["sec","cn"])assert(/^[1-9][0-9]*$/.test(proof.generations[kind]));
' "$bucket"
for kind in sec cn; do
  gcloud storage objects describe "$prefix/$kind.json" >/dev/null
done
