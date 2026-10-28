import { FieldPath } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { withSearchEntityReads } from '@/lib/local-cache/company-directory';

export async function GET(request: NextRequest) {
  return withSearchEntityReads(() => unmatchedCik(request));
}

async function unmatchedCik(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const user = await getDecodedUserFromRequest(request);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    if (!await isAdminUser(user)) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    const after = request.nextUrl.searchParams.get('after') ?? '';
    if (after && !/^US:[A-Z0-9][A-Z0-9.-]{0,30}$/.test(after)) return Response.json({ error: 'Invalid cursor' }, { status: 400, headers });
    const db = getAdminFirestore();
    let query = db.collection('companies').select('name', 'symbol', 'cik', 'active')
      .where(FieldPath.documentId(), '>=', 'US:').where(FieldPath.documentId(), '<=', 'US:\uf8ff')
      .orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(after);
    const snapshot = await query.limit(101).get();
    const records = snapshot.docs.slice(0, 100);

    const items = records.filter(record => !/^\d{1,10}$/.test(String(record.data().cik ?? '')) || Number(record.data().cik) === 0).map(record => {
      const data = record.data();
      return { id: record.id, name: String(data.name ?? record.id), symbol: String(data.symbol ?? record.id.slice(3)),
        active: data.active === true };
    });
    return Response.json({ items, scanned: records.length, nextCursor: snapshot.docs.length > 100 ? records.at(-1)!.id : null }, { headers });
  } catch {
    return Response.json({ error: 'Unable to load companies without a matched CIK' }, { status: 503, headers });
  }
}
