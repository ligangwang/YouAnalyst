import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
function run(statuses: string, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "fundamentals-build-"));
  try {
    const result = spawnSync(bash, ["-c", `
      gcloud() {
        echo "$*" >> "$CALLS"
        if [[ "$1 $2" == "builds submit" ]]; then
          [[ "$*" == *"--async"* ]] || return 99
          [[ "$SUBMIT_FAIL" == "1" ]] && return 1
          printf '%s\\n' "$BUILD_ID"
        else
          [[ "$DESCRIBE_FAIL" == "1" ]] && return 1
          head -n 1 "$STATUSES"
          sed -i '1d' "$STATUSES"
        fi
      }
      sleep() { :; }
      export -f gcloud sleep
      printf '%s\\n' $STATUS_VALUES > "$STATUSES"
      bash scripts/build-fundamentals.sh example/image:revision
    `], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, SUBMIT_FAIL: "0", DESCRIBE_FAIL: "0", GCP_PROJECT_ID: "demo", BUILD_ID: "build-123", STATUS_VALUES: statuses,
        CALLS: path.join(dir, "calls").replaceAll("\\", "/"), STATUSES: path.join(dir, "statuses").replaceAll("\\", "/"), ...extra },
    });
    assert.ifError(result.error);
    return { ...result, calls: readFileSync(path.join(dir, "calls"), "utf8") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("waits through pending states and succeeds without reading build logs", () => {
  const result = run("PENDING QUEUED WORKING SUCCESS");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.match(/builds describe/g)?.length, 4);
  assert.match(result.calls, /--async --format=value\(id\)/);
  assert.doesNotMatch(result.calls, /builds log|suppress-logs/);
});

for (const status of ["FAILURE", "CANCELLED", "TIMEOUT", "EXPIRED", "INTERNAL_ERROR", "STATUS_UNKNOWN", ""]) {
  test(`rejects unsuccessful or missing status: ${status}`, () => {
    const result = run(status);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected or unsuccessful status/);
  });
}

for (const extra of [{ SUBMIT_FAIL: "1" }, { BUILD_ID: "" }, { DESCRIBE_FAIL: "1" }] as Record<string, string>[]) {
  test(`stops on build API error: ${JSON.stringify(extra)}`, () => {
    const result = run("SUCCESS", extra);
    assert.notEqual(result.status, 0);
    if (!extra.DESCRIBE_FAIL) assert.doesNotMatch(result.calls, /builds describe/);
  });
}
