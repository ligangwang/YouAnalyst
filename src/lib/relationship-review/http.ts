import type { Firestore } from 'firebase-admin/firestore';
import { approveRelationship, getReviewCandidate, getReviewCompany, listReviewCandidates, previewRelationship, rejectRelationship, RelationshipReviewError } from './service';
import { searchIdentityCandidates } from '../market-companies/name-resolution';

type Dependencies = { authenticate: (request: Request) => Promise<{ uid: string; admin: boolean } | null>; db: () => Firestore };
export async function relationshipReviewResponse(request: Request, deps: Dependencies) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const actor = await deps.authenticate(request);
    if (!actor) return Response.json({ error: 'Sign in to review relationships' }, { status: 401, headers });
    if (!actor.admin) return Response.json({ error: 'Administrator access required' }, { status: 403, headers });
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      const result = q.has('companyId') ? await getReviewCompany(deps.db(), q.get('companyId') ?? '')
        : q.has('company') ? await searchIdentityCandidates(deps.db(), q.get('company') ?? '')
        : q.has('id') ? await getReviewCandidate(deps.db(), q.get('id') ?? '')
          : await listReviewCandidates(deps.db(), q.get('status') ?? 'NEEDS_REVIEW', q.get('after') ?? '');
      return Response.json(result, { headers });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({ error: 'Use application/json' }, { status: 415, headers });
    const reader = request.body?.getReader(); if (!reader) throw new RelationshipReviewError(400, 'JSON body required');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 16_000) { await reader.cancel(); throw new RelationshipReviewError(413, 'Request too large'); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); }
    catch { throw new RelationshipReviewError(400, 'Invalid JSON'); }
    if (Object.keys(body).some(k => !['action', 'input', 'previewToken'].includes(k))) throw new RelationshipReviewError(400, 'Unknown review field');
    let result;
    if (body.action === 'preview') result = await previewRelationship(deps.db(), body.input);
    else if (body.action === 'approve') result = await approveRelationship(deps.db(), body.input, String(body.previewToken ?? ''), actor.uid);
    else if (body.action === 'reject') result = await rejectRelationship(deps.db(), body.input, actor.uid);
    else throw new RelationshipReviewError(400, 'Invalid review action');
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof RelationshipReviewError ? error.message : 'Unable to review relationships. Reload and try again.' }, { status: error instanceof RelationshipReviewError ? error.status : 503, headers });
  }
}
