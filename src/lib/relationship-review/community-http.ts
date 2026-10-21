import type { Firestore } from 'firebase-admin/firestore';
import { communityRelationship, listContributions, memberContributions, resolveContribution, submitContribution } from './community';
import { RelationshipReviewError } from './service';

type Dependencies = { db: () => Firestore; authenticate: (request: Request) => Promise<{ uid: string; admin: boolean } | null> };
export async function communityResponse(request: Request, deps: Dependencies, admin = false) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const actor = await deps.authenticate(request);
    if (admin && !actor?.admin) return Response.json({ error: 'Administrator access required' }, { status: actor ? 403 : 401, headers });
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      if (!admin && q.get('mine') === '1') {
        if (!actor) return Response.json({ error: 'Sign in to view your contributions' }, { status: 401, headers });
        return Response.json(await memberContributions(deps.db(), actor.uid), { headers });
      }
      return Response.json(admin ? await listContributions(deps.db(), q.get('after') ?? '', q.get('status') ?? 'OPEN') : await communityRelationship(deps.db(), q.get('relationshipId') ?? ''), { headers });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    if (!actor) return Response.json({ error: 'Sign in to contribute' }, { status: 401, headers });
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new RelationshipReviewError(415, 'Use application/json');
    const reader = request.body?.getReader(); if (!reader) throw new RelationshipReviewError(400, 'JSON body required');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16_000) { await reader.cancel(); throw new RelationshipReviewError(413, 'Request too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RelationshipReviewError(400, 'Invalid JSON'); }
    return Response.json(admin ? await resolveContribution(deps.db(), body, actor.uid) : await submitContribution(deps.db(), body, actor.uid), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof RelationshipReviewError ? error.message : 'Relationship contribution unavailable. Please try again.' }, { status: error instanceof RelationshipReviewError ? error.status : 503, headers });
  }
}
