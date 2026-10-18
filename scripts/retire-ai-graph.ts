import {OAuth2Client} from "google-auth-library";
import {applicationDefault, initializeApp} from 'firebase-admin/app';
import {FieldPath, Firestore, getFirestore} from 'firebase-admin/firestore';
import {retireAiGraph} from '../src/lib/company-themes/retire-ai-graph';

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!['--apply', '--writers-paused'].includes(arg)) throw Error(`Unknown argument: ${arg}`);
  const apply = args.has('--apply');
  if (!process.env.GCP_PROJECT_ID) throw Error('GCP_PROJECT_ID is required');
  if (apply && !args.has('--writers-paused')) throw Error('Pause company writers before applying; acknowledge with --writers-paused');
  const projectId = process.env.GCP_PROJECT_ID;
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const authClient = new OAuth2Client();
  if (token) authClient.setCredentials({access_token: token});
  else initializeApp({credential: applicationDefault(), projectId});
  const db = token ? new Firestore({projectId, authClient}) : getFirestore();
  const counts: Record<string, number> = {};
  let cursor: string | undefined;
  // One-time paged scan also finds withdrawn/draft legacy fields; no aiGraph index needed.
  while (true) {
    let query = db.collection('companies').orderBy(FieldPath.documentId()).select('aiGraph').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      cursor = doc.id;
      if (!Object.hasOwn(doc.data(), 'aiGraph')) continue;
      const status = await retireAiGraph(db, doc.id, apply);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    if (page.size < 200) break;
  }
  console.log(JSON.stringify({project: process.env.GCP_PROJECT_ID, apply, counts}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
