import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { seedChinaCompanies } from "../src/lib/industry-research/china-directory";

async function main() {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID is required.");
  initializeApp({ credential: applicationDefault(), projectId });
  const result = await seedChinaCompanies(getFirestore(), "deployment-migration");
  console.log("A-share starter companies:", JSON.stringify(result));
}
main().catch(() => { console.error("A-share company migration failed."); process.exitCode = 1; });
