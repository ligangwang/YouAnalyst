import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(limit: string) {
  // Disabled execution exits before Firebase initialization or any SEC request.
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/collect-sec-filings.ts", "--apply"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, GCP_PROJECT_ID: "", SEC_FILINGS_COLLECTOR_ENABLED: "0", SEC_FILINGS_MAX_COMPANIES: limit },
  });
}
test("collector execution limits are validated before credentials or cloud work", () => {
  for (const limit of ["0", "501", "1.5", "no", "Infinity"]) {
    const result = run(limit);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SEC_FILINGS_MAX_COMPANIES must be an integer from 1 to 500/);
  }
});
test("valid bounded executions remain inert while collection is disabled", () => {
  for (const limit of ["1", "500"]) {
    const result = run(limit);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"status":"paused"/);
  }
});
