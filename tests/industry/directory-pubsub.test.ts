import { test } from "node:test";
import assert from "node:assert/strict";
import { pubsubFirestore } from "../helpers/pubsub-firestore";
import { processDirectoryRequest, publishDirectoryRequest, type DirectoryRequest } from "../../src/lib/industry-research/directory-pubsub";
import { importCniDirectory } from "../../src/lib/industry-research/directory-sync";

const snapshot = () => ({ source: "https://www.cnindex.com.cn/zh_information/data_resource/fljg/test", snapshot: "2026-09", sha256: "a".repeat(64),
  companies: Array.from({ length: 4000 }, (_, i) => ({ id: `XSHG:${600000 + i}`, name: `Company ${i}`,
    classification: Array.from({ length: 4 }, (_, level) => ({ code: `C${level}`, name: `Industry ${level}` })) })) });
async function setup() {
  const f = pubsubFirestore(), requests: DirectoryRequest[] = [];
  await publishDirectoryRequest(f.db, "execution-1", async r => { requests.push(r); });
  return { ...f, request: requests[0] };
}
test("directory publisher retries reuse the request and validation precedes import", async () => {
  const f = await setup();
  await publishDirectoryRequest(f.db, "execution-1", async r => { assert.deepEqual(r, f.request); });
  await publishDirectoryRequest(f.db, "execution-2", async r => { assert.deepEqual(r, f.request); });
  await assert.rejects(importCniDirectory(f.db, snapshot()), /queued directory import/);
  await assert.rejects(processDirectoryRequest(f.request, f.db, f.log, { download: async () => ({ ...snapshot(), companies: [] }) }), /Invalid directory/);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("company_directory/")).length, 0);
});
test("directory retries use a frozen snapshot and atomically resume partial imports", async () => {
  const f = await setup(); let downloads = 0;
  const download = async () => { downloads++; return snapshot(); };
  f.reject((_path, data) => data.offset === 200);
  await assert.rejects(processDirectoryRequest(f.request, f.db, f.log, { download }), /transaction failed/);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("company_directory/")).length, 100);
  assert.equal(f.rows.get("directory_syncs/CN_A_CNI")?.sha256, undefined);
  f.reject(() => false);
  await assert.rejects(processDirectoryRequest(f.request, f.db, f.log, { download, deadline: Date.now() }), /incomplete/);
  const result = await processDirectoryRequest(f.request, f.db, f.log, { download });
  assert.equal(result.count, 4000); assert.equal(downloads, 1);
  assert.equal(f.writes.filter(p => p === "company_directory/XSHG:600000").length, 1);
  assert.equal((await processDirectoryRequest(f.request, f.db, f.log, { download })).duplicate, true);
  assert.equal(downloads, 1);
  assert.equal(f.rows.get("directory_syncs/CN_A_CNI")?.activeRequest, null);
  await publishDirectoryRequest(f.db, "execution-2", async r => { assert.notEqual(r.batchId, f.request.batchId); });
});
test("older directory snapshots cannot overwrite a completed newer import", async () => {
  const f = await setup();
  Object.assign(f.rows.get("directory_syncs/CN_A_CNI")!, { snapshot: "2026-10", sha256: "b".repeat(64) });
  await assert.rejects(processDirectoryRequest(f.request, f.db, f.log, { download: async () => snapshot() }), /older snapshot/);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("company_directory/")).length, 0);
});
