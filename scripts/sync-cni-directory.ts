import { readFile } from "node:fs/promises";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { importCniDirectory } from "../src/lib/industry-research/directory-sync";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";

import { publishDirectoryRequest } from "../src/lib/industry-research/directory-pubsub";
import { publishJobMessage } from "../src/lib/job-pubsub";
const inputFile = process.argv.slice(2).find(arg => !arg.startsWith("--"));

const log = createMaintenanceLog("sync-cni-directory");

async function main() {
  if (!process.env.GCP_PROJECT_ID) throw new Error("Project required.");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  if (!inputFile && !process.argv.includes("--direct") && process.env.DIRECTORY_REQUEST_TOPIC) {
    log.emit("INFO", "run_started", { mode: "pubsub" });
    const result = await publishDirectoryRequest(db, process.env.CLOUD_RUN_EXECUTION || log.runId,
      request => publishJobMessage(process.env.DIRECTORY_REQUEST_TOPIC!, request));
    log.emit("INFO", "run_completed", result); return;
  }
  const lease = db.collection("directory_syncs").doc("CN_A_CNI");
  log.stage("acquire_lease");
  if (!await acquireMaintenanceLease(lease, log.runId, Date.now(), cloudRunTaskAttempt())) {
    throw new Error("Directory sync lease is held by another task; import did not complete.");
  }
  try {
    const input = inputFile ?? "/tmp/cni-directory.json";
    if (!inputFile) {
      log.stage("download_snapshot");
      const { stdout } = await promisify(execFile)("python3", ["scripts/download-cni-directory.py", input], { timeout: 150_000 });
      log.emit("INFO", "snapshot_downloaded", JSON.parse(stdout));
    }
    log.stage("import_snapshot");
    const result = await importCniDirectory(db, JSON.parse(await readFile(input, "utf8")), log);
    log.emit("INFO", "run_completed", result);
  } finally {
    await releaseMaintenanceLease(lease, log.runId).catch(error => log.emit("ERROR", "lease_release_failed", { error: maintenanceError(error) }));
  }
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
