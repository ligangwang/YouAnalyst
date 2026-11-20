import { Timestamp, type DocumentData, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encode, decode } from '../central-cache/codec';
import { ANNOUNCEMENT_EVENT_FIELDS, announcementCachePath, announcementSearchLimit } from './announcement-projection';

// Application writes invalidate the affected companies in their source transaction.
// Bound staleness for administrative imports that bypass the application.
const maxAgeMs = 60 * 60_000;
type AnnouncementWindow = { rows: DocumentData[]; complete: boolean };

function readWindow(snapshot: DocumentSnapshot): AnnouncementWindow | undefined {
  const saved = snapshot.data();
  if (!(saved?.builtAt instanceof Timestamp) || Date.now() - saved.builtAt.toMillis() >= maxAgeMs || !Buffer.isBuffer(saved.payload)) return;
  const rows = decode(JSON.parse(gunzipSync(saved.payload).toString('utf8'))) as DocumentData[];
  return { rows, complete: saved.complete === true };
}

export async function readSharedAnnouncementWindow(
  db: Firestore,
  companyId: string,
  initialLimit = announcementSearchLimit,
  needsMore: (rows: DocumentData[]) => boolean = () => false,
): Promise<DocumentData[]> {
  const ref = db.doc(announcementCachePath(companyId));
  // Read under lock so simultaneous cold instances share one fill and a
  // concurrent source change cannot race an obsolete window back into use.
  const result = await db.runTransaction(async tx => {
    const existing = readWindow(await tx.get(ref));
    if (existing && (existing.complete || (existing.rows.length >= initialLimit && !needsMore(existing.rows))))
      return { action: 'hit', rows: existing.rows };

    const query = db.collection('events').where('companyId', '==', companyId).orderBy('publication_date', 'desc')
      .select(...ANNOUNCEMENT_EVENT_FIELDS);
    const first = await tx.get(query.limit(initialLimit));
    const rows = first.docs.map(doc => doc.data());
    let complete = first.size < initialLimit || initialLimit === announcementSearchLimit;
    if (!complete && needsMore(rows)) {
      const tail = await tx.get(query.startAfter(first.docs[first.size - 1]).limit(announcementSearchLimit - initialLimit));
      rows.push(...tail.docs.map(doc => doc.data()));
      complete = true;
    }
    const payload = gzipSync(JSON.stringify(encode(rows)));
    if (payload.length > 900_000) return { action: 'oversize', rows };
    tx.set(ref, { builtAt: Timestamp.now(), payload, complete });
    return { action: 'fill', rows };
  });
  console.info(JSON.stringify({ event: 'company_announcement_window', action: result.action, companyId, rows: result.rows.length }));
  return result.rows;
}
