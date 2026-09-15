import type { Firestore } from "firebase-admin/firestore";
import type { PublicEvent } from "./model";
import { activityFromTransaction, type InsiderActivity } from "./insider-summary";

const caches = new WeakMap<Firestore, Map<string, {expires:number; activity:InsiderActivity[]}>>();
/** Read existing parsed public records; never infer a purchase from an acquisition code. */
export async function enrichFilingEvents(items: PublicEvent[], db: Firestore): Promise<PublicEvent[]> {
  let cache = caches.get(db);
  if (!cache) { cache = new Map(); caches.set(db,cache); }
  return Promise.all(items.map(async event => {
    if (event.type !== "SEC_FORM4" || event.activity?.length) return event;
    const key = `${event.id}:${event.updatedAt}`;
    let cached = cache.get(key);
    if (!cached || cached.expires < Date.now()) {
      try {
        const rows = await db.collection("insider_transactions").where("accessionNumber","==",event.accessionNumber).limit(5).get();
        const activity = rows.docs.flatMap(doc => { const value = activityFromTransaction(doc.data(),event.accessionNumber); return value ? [value] : []; });
        cached = {expires:Date.now()+300000,activity};
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(key,cached);
      } catch { return event; }
    }
    return {...event,activity:cached.activity};
  }));
}
