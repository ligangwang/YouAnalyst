import { createHash } from "node:crypto";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getDailyScores } from "@/lib/daily-scores/service";
import { writeTopCall } from "./top-call-openai";
import { easternDate, eodReady, topCallFacts, type RecentPost } from "./top-call-writing";

export async function prepareTopCall(date = easternDate()) {
  const db = getAdminFirestore();
  const runRef = db.collection("eod_runs").doc(`US_${date}`);
  const run = await runRef.get();
  if (!eodReady(run.data(), date)) return { status: "SKIPPED", reason: "EOD incomplete or no fresh trading data" };
  const scores = await getDailyScores(date);
  if (scores.date !== date || !scores.callOfTheDay) return { status: "SKIPPED", reason: "No Top Call for this date" };
  const call = scores.callOfTheDay;
  // Protect against legacy daily-scores normalization treating null as zero.
  const mark = await db.collection("prediction_daily_marks").doc(`${call.predictionId}_${date}`).get();
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  if (!numeric(mark.get("markReturnValue")) ||
      !(numeric(mark.get("directionDailyReturn")) || numeric(mark.get("tickerDailyReturn")))) {
    return { status: "SKIPPED", reason: "Missing source returns" };
  }
  const facts = topCallFacts(date, call);
  const fingerprint = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  const ref = db.collection("social_top_call_drafts").doc(date);
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.get("fingerprint") !== fingerprint) throw new Error("Source changed; review existing draft before publishing");
    return existing.data();
  }
  // Single-field index; only confirmed publications enter the writing history.
  const history = await db.collection("social_top_call_publications").orderBy("publishedAt", "desc").limit(10).get();
  const recent: RecentPost[] = history.docs.map((doc) => ({ text: String(doc.get("text")), opening: String(doc.get("opening")) }));
  const generated = await writeTopCall(facts, recent);
  const draft = { status: "DRAFT", date, fingerprint, facts, text: generated.text,
    opening: generated.writing.opening, layout: generated.writing.layout, model: generated.model,
    createdAt: new Date().toISOString() };
  return db.runTransaction(async (tx) => {
    const [current, currentRun] = await Promise.all([tx.get(ref), tx.get(runRef)]);
    if (!eodReady(currentRun.data(), date) || currentRun.get("completedAt") !== run.get("completedAt")) {
      throw new Error("EOD changed during generation; retry after completion");
    }
    if (current.exists) {
      if (current.get("fingerprint") !== fingerprint) throw new Error("Concurrent draft source mismatch");
      return current.data();
    }
    tx.create(ref, draft);
    return draft;
  });
}

// Trusted publisher acknowledgement, not an X API call or independent verification.
export async function recordTopCallPublication(date: string, postId: string, text: string) {
  const db = getAdminFirestore();
  const draftRef = db.collection("social_top_call_drafts").doc(date);
  const publicationRef = db.collection("social_top_call_publications").doc(date);
  return db.runTransaction(async (tx) => {
    const [draft, publication] = await Promise.all([tx.get(draftRef), tx.get(publicationRef)]);
    if (!draft.exists || draft.get("text") !== text) throw new Error("Publication does not match stored draft");
    if (publication.exists) {
      if (publication.get("postId") !== postId) throw new Error("A different post is already recorded for this date");
      return publication.data();
    }
    const record = { date, postId, text, opening: draft.get("opening"), publishedAt: new Date().toISOString() };
    tx.create(publicationRef, record);
    tx.update(draftRef, { status: "PUBLISHED", postId });
    return record;
  });
}
