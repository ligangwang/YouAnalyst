import { getAdminFirestore } from "./firebase/admin";
import { followedCompanyIds } from "./knowledge-graph/follows";
import { savedCompanyTickers } from "./industry-graph/saved-companies";

function ids(data: Record<string, unknown> | undefined) {
  return followedCompanyIds([...(Array.isArray(data?.followedCompanyIds) ? data.followedCompanyIds : []), ...savedCompanyTickers(data?.tickers).map(t => `US:${t}`)]);
}
export async function readCompanyFollows(uid: string) {
  return ids((await getAdminFirestore().collection("industry_map_preferences").doc(uid).get()).data());
}
export async function updateCompanyFollow(uid: string, id: string, follow: boolean) {
  const db = getAdminFirestore(), ref = db.collection("industry_map_preferences").doc(uid);
  return db.runTransaction(async tx => {
    const current = ids((await tx.get(ref)).data());
    const next = follow ? [...new Set([...current, id])] : current.filter(value => value !== id);
    if (next.length > 200) throw new Error("Follow limit reached");
    tx.set(ref, { followedCompanyIds: next, tickers: next.filter(value => value.startsWith("US:")).map(value => value.slice(3)) }, { merge: true });
    return next;
  });
}
