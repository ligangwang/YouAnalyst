import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { inspectSavedGraphProviderResponse } from "./graph-provider-inspection";

async function main() {
  if (process.argv.length !== 2 || process.env.COMPANY !== "NVDA" || process.env.GCP_PROJECT_ID !== "ifindata-80905") {
    throw new Error("Only the explicit saved NVDA response in production may be inspected");
  }
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(JSON.stringify(await inspectSavedGraphProviderResponse(getFirestore(),
    process.env.EXPECTED_GRAPH_REQUEST_ID ?? "", process.env.OPENAI_API_KEY ?? "")));
}
main().catch(() => {
  console.error("Saved provider response inspection failed; no response body, credentials or raw error were logged.");
  process.exitCode = 1;
});
