import { Readable } from 'node:stream';
import { audioRange, BUILTIN_ID, MusicError, validTrackId } from '@/lib/music/model';
import { musicBucket, musicObjectPath, musicStore } from '@/lib/music/storage';
export const runtime = 'nodejs';
async function serve(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let size = 0;
  try {
    const { id } = await params;
    if (!validTrackId(id) || id === BUILTIN_ID) throw new MusicError(404, 'Track not found');
    const playlist = await musicStore.read();
    if (!playlist.tracks.some(t => t.id === id)) throw new MusicError(404, 'Track not found');
    const file = musicBucket().file(musicObjectPath(id));
    const [metadata] = await file.getMetadata();
    size = Number(metadata.size);
    const { start, end, partial } = audioRange(request.headers.get('range'), size);
    const headers: Record<string, string> = { 'Content-Type': 'audio/mpeg', 'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'public, max-age=3600' };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: partial ? 206 : 200, headers });
    const stream = file.createReadStream({ start, end });
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: partial ? 206 : 200, headers });
  } catch (error) {
    const status = error instanceof MusicError ? error.status : Number((error as { code?: unknown })?.code) === 404 ? 404 : 503;
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...(status === 416 ? { 'Content-Range': `bytes */${size}` } : {}) } });
  }
}
export const GET = serve;
export const HEAD = serve;
