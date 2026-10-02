import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function inspect(value: unknown, raw = false, fail = false) {
  const dir = mkdtempSync(join(tmpdir(), "graph-topic-inspect-"));
  try {
    writeFileSync(join(dir, "service.json"), raw ? String(value) : JSON.stringify(value));
    writeFileSync(join(dir, "gcloud"), `#!/bin/sh\n[ "$1 $2 $3 $4" = "run services describe ifindata-web" ] || exit 3\ncat "$MOCK_FILE"\nexit ${fail ? 4 : 0}\n`, { mode: 0o755 });
    return spawnSync("bash", ["scripts/inspect-graph-topic.sh"], { encoding: "utf8", env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_FILE: join(dir, "service.json"),
      GCP_PROJECT_ID: "test", GCP_REGION: "us-central1", CLOUD_RUN_SERVICE_PRODUCTION: "ifindata-web", COMPANY_GRAPH_PAID_ADMISSION_ENABLED: "1",
    } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const sentinel = "DO_NOT_PRINT_OTHER_ENV_VALUES";
const service = (env: unknown[]) => ({ spec: { template: { spec: { containers: [{ env }] } } } });
test("runtime inspection prints only the expected non-secret graph topic", () => {
  const result = inspect(service([{ name: "OTHER_CONFIG", value: sentinel },
    { name: "COMPANY_GRAPH_REQUEST_TOPIC", value: "company-graph-requests" },
    { name: "COMPANY_GRAPH_PAID_ADMISSION_ENABLED", value: "1" }]));
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "COMPANY_GRAPH_REQUEST_TOPIC=company-graph-requests\nCOMPANY_GRAPH_PAID_ADMISSION_ENABLED=1");
  assert.equal(result.stderr, "");
});
test("runtime inspection fails closed without disclosing malformed or unexpected values", () => {
  for (const value of [service([]), service([{ name: "COMPANY_GRAPH_REQUEST_TOPIC", value: sentinel }]),
    service([{ name: "COMPANY_GRAPH_REQUEST_TOPIC", valueFrom: { secretKeyRef: { name: sentinel } } }]),
    service([{ name: "COMPANY_GRAPH_REQUEST_TOPIC", value: "company-graph-requests" }, { name: "COMPANY_GRAPH_REQUEST_TOPIC", value: "company-graph-requests" }]),
    service([{ name: "COMPANY_GRAPH_REQUEST_TOPIC", value: "company-graph-requests" }, { name: "COMPANY_GRAPH_PAID_ADMISSION_ENABLED", value: "0" }]),
    { unexpected: sentinel }]) {
    const result = inspect(value);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, new RegExp(sentinel));
  }
  const malformed = inspect(`malformed: ${sentinel}`, true);
  assert.notEqual(malformed.status, 0); assert.doesNotMatch(malformed.stderr, new RegExp(sentinel));
  assert.notEqual(inspect({}, false, true).status, 0);
});
