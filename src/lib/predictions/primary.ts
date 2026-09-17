import { canonicalPredictionStatus } from "./types";

export async function choosePrimaryPrediction(db: FirebaseFirestore.Firestore, userId: string, predictionId: string) {
  await db.runTransaction(async tx => {
    const [prediction, profile] = await Promise.all([tx.get(db.collection("predictions").doc(predictionId)), tx.get(db.collection("users").doc(userId))]);
    if (!profile.exists || !prediction.exists || prediction.get("userId") !== userId || !["CREATED", "OPEN"].includes(canonicalPredictionStatus(prediction.get("status")) ?? "")) throw new Error("Choose your own active prediction");
    tx.update(profile.ref, {
      publishingPrimaryPredictions: { ...(profile.get("publishingPrimaryPredictions") ?? {}), [prediction.get("ticker")]: predictionId },
      updatedAt: new Date().toISOString(),
    });
  });
}
