import { Firestore } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";
import { backfillLatestEod } from "../src/lib/predictions/backfill-latest-eod";

async function main() {
  const authClient = new OAuth2Client();
  if (process.env.BACKFILL_ACCESS_TOKEN) authClient.setCredentials({access_token:process.env.BACKFILL_ACCESS_TOKEN});
  const db = new Firestore({projectId:process.env.GCP_PROJECT_ID,
    ...(process.env.BACKFILL_ACCESS_TOKEN ? {authClient} : {})});
  await backfillLatestEod(db, process.argv.includes("--apply"));
}
main().catch(error => {console.error(error);process.exitCode=1;});
