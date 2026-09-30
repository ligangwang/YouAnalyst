import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { musicStore, type MusicStore } from './storage';
import { BUILTIN_ID, MAX_TRACK_BYTES, MAX_TRACKS, MusicError, reorderTracks, trackUrl, validTrackId, validateMp3 } from './model';

const headers = { 'Cache-Control': 'private, no-store' };
export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new MusicError(413, 'Request too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new MusicError(400, 'Request body required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new MusicError(413, 'Request too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const defaults = {
  store: musicStore,
  async authorize(request: NextRequest) {
    const user = await getDecodedUserFromRequest(request);
    if (!user) throw new MusicError(401, 'Unauthorized');
    if (!await isAdminUser(user)) throw new MusicError(403, 'Forbidden');
  },
};
export async function adminMusicResponse(request: NextRequest, deps: { store: MusicStore; authorize: typeof defaults.authorize } = defaults) {
  try {
    await deps.authorize(request);
    const playlist = await deps.store.read();
    if (request.method === 'GET') return Response.json(playlist, { headers });
    const revision = request.headers.get('if-match');
    if (!revision) throw new MusicError(428, 'Reload the playlist before editing.');
    const deleteId = request.nextUrl.searchParams.get('id') ?? '';
    // Cleanup of an already-unpublished UUID does not mutate the manifest.
    const cleanupOnly = request.method === 'DELETE' && validTrackId(deleteId)
      && !playlist.tracks.some(track => track.id === deleteId);
    if (revision !== playlist.revision && !cleanupOnly) throw new MusicError(409, 'The playlist changed. Reload and try again.');
    if (request.method === 'POST') {
      if (playlist.tracks.length >= MAX_TRACKS) throw new MusicError(400, 'The playlist can contain up to 100 tracks.');
      if (request.headers.get('content-type')?.split(';')[0] !== 'audio/mpeg') throw new MusicError(415, 'Upload MP3 audio.');
      const filename = request.nextUrl.searchParams.get('filename') ?? '';
      const bytes = await limitedBody(request, MAX_TRACK_BYTES);
      validateMp3(bytes, filename);
      const id = randomUUID();
      await deps.store.upload(id, bytes);
      try {
        const updated = await deps.store.save([...playlist.tracks, { id, title: filename.replace(/\.mp3$/i, '').trim() || 'Untitled', bytes: bytes.length, uploadedAt: new Date().toISOString() }], revision);
        return Response.json(updated, { status: 201, headers });
      } catch (error) {
        // Only a failed precondition proves publication did not happen; a timeout may
        // occur after the write commits, so never delete a potentially published file.
        if (error instanceof MusicError && error.status === 409) {
          try {
            const latest = await deps.store.read();
            if (!latest.tracks.some(track => track.id === id)) await deps.store.remove(id);
          } catch { /* Keep the file if publication status cannot be established. */ }
        }
        throw error;
      }
    }
    if (request.method === 'PATCH') {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new MusicError(415, 'Use application/json.');
      let input: { ids?: unknown };
      try { input = JSON.parse((await limitedBody(request, 16384)).toString()); }
      catch (error) { if (error instanceof MusicError) throw error; throw new MusicError(400, 'Invalid playlist order.'); }
      return Response.json(await deps.store.save(reorderTracks(playlist.tracks, input?.ids), revision), { headers });
    }
    if (request.method === 'DELETE') {
      const id = request.nextUrl.searchParams.get('id') ?? '';
      if (!validTrackId(id)) throw new MusicError(400, 'Invalid track.');
      const updated = playlist.tracks.some(t => t.id === id)
        ? await deps.store.save(playlist.tracks.filter(t => t.id !== id), revision) : playlist;
      // Remove from the published playlist before removing the object. Retrying is safe.
      if (id !== BUILTIN_ID) {
        try { await deps.store.remove(id); }
        catch { return Response.json({ ...updated, cleanupPending: id, warning: 'Track removed from playlist. File deletion failed; retry file removal.' }, { headers }); }
      }
      return Response.json(updated, { headers });
    }
    throw new MusicError(405, 'Method not allowed.');
  } catch (error) {
    return Response.json({ error: error instanceof MusicError ? error.message : 'Music storage is unavailable. Please retry.' }, { status: error instanceof MusicError ? error.status : 503, headers });
  }
}

export async function publicMusicResponse(store: MusicStore = musicStore) {
  try {
    const playlist = await store.read();
    return Response.json({ revision: playlist.revision, tracks: playlist.tracks.map(t => ({ id: t.id, title: t.title, url: trackUrl(t.id) })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Playlist unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
