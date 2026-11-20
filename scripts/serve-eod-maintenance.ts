import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { parseEodMessage, processEodCompanyMessage } from "../src/lib/predictions/eod-company-queue";
import { loadSupportedInstrumentUniverse } from "../src/lib/instruments/support-service";
import { createHash } from "node:crypto";
import { writeUserDailyScoreSnapshots } from "../src/lib/predictions/eod-prices";
import { closeLocalCaches } from "../src/lib/local-cache/watch";
const verifyUniverse = process.argv.includes('--verify-instrument-universe');
const scoreDates = process.argv.find(arg => arg.startsWith('--verify-prediction-scores='))?.split('=')[1]?.split(',');
if (scoreDates && (scoreDates.length > 3 || scoreDates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))))
  throw Error('Expected up to three score verification dates');
if (!process.env.GCP_PROJECT_ID || (!verifyUniverse && !scoreDates && !process.env.EOD_SUBSCRIPTION)) throw Error("Missing EOD subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
async function verifyScores(dates: string[]) {
  for (const date of dates) {
    const started = Date.now();
    const marks = await db.collection('prediction_daily_marks').where('date', '==', date).get();
    const users = [...new Set(marks.docs.map(doc => doc.get('userId')).filter((id): id is string => typeof id === 'string' && !!id))].sort();
    if (!users.length) throw Error('No prediction scores to verify');
    const scores: Array<[string, FirebaseFirestore.DocumentData]> = [];
    const result = await writeUserDailyScoreSnapshots(db, users, date, date + 'T23:59:59.000Z', undefined,
      (id, score) => { scores.push([id, score]); });
    if (!result.userScores) throw Error('No scores derived from prediction marks');
    console.log(JSON.stringify({event:'prediction_score_verification',date,marks:marks.size,users:users.length,...result,
      digest:createHash('sha256').update(JSON.stringify(scores)).digest('hex'),durationMs:Date.now()-started}));
  }
}
if (scoreDates) {
  verifyScores(scoreDates).catch(error => {console.error(error);process.exitCode=1;})
    .finally(async()=>{await closeLocalCaches();await db.terminate();});
} else if (verifyUniverse) {
  loadSupportedInstrumentUniverse(db).catch(error => {console.error(error);process.exitCode=1;})
    .finally(async()=>{await closeLocalCaches();await db.terminate();});
} else createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.EOD_SUBSCRIPTION!,
  job: "eod-maintenance-batch", parse: parseEodMessage,
  process: (request, log) => processEodCompanyMessage(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
