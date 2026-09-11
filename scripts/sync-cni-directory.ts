import { readFile } from "node:fs/promises";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { importCniDirectory } from "../src/lib/industry-research/directory-sync";

async function main() {
  if (!process.env.GCP_PROJECT_ID || !process.argv[2]) throw new Error("Project and input file required.");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(await importCniDirectory(getFirestore(), JSON.parse(await readFile(process.argv[2], "utf8"))));
}
main().catch(() => { console.error("CNI directory sync failed; completed snapshot was not advanced."); process.exitCode = 1; });
