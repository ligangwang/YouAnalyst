import { FieldValue } from "firebase-admin/firestore";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { createSavedCompanyHandlers } from "@/lib/industry-graph/saved-companies";
import { loadIndustryGraph } from "@/lib/industry-graph/service";

export const runtime = "nodejs";
const handlers = createSavedCompanyHandlers({
  authenticate: getDecodedUserFromRequest,
  async exists(ticker) {
    return (await loadIndustryGraph({ ticker })).nodes.some((node) => node.ticker === ticker);
  },
  async read(uid) {
    return (await getAdminFirestore().collection("industry_map_preferences").doc(uid).get()).data()?.tickers;
  },
  async update(uid, ticker, saved) {
    const doc = getAdminFirestore().collection("industry_map_preferences").doc(uid);
    // Atomic membership changes preserve saves from other tabs; repeats are idempotent.
    await doc.set({ tickers: saved ? FieldValue.arrayUnion(ticker) : FieldValue.arrayRemove(ticker) }, { merge: true });
    return (await doc.get()).data()?.tickers;
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
