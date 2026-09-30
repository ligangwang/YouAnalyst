export const MAX_TRACK_BYTES = 20 * 1024 * 1024;
export const MAX_TRACKS = 100;
export const BUILTIN_ID = 'builtin-blisters';
export type MusicTrack = { id: string; title: string; bytes: number; uploadedAt: string };
export type MusicPlaylist = { revision: string; tracks: MusicTrack[] };
export const initialTracks: MusicTrack[] = [{ id: BUILTIN_ID, title: 'Blisters', bytes: 5162817, uploadedAt: '' }];
export function validTrackId(id: string) {
  return id === BUILTIN_ID || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}
export function trackUrl(id: string) {
  return id === BUILTIN_ID ? '/audio/blisters.mp3' : `/api/music/tracks/${id}`;
}
export class MusicError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function reorderTracks(tracks: MusicTrack[], ids: unknown): MusicTrack[] {
  if (!Array.isArray(ids) || ids.length !== tracks.length || new Set(ids).size !== tracks.length
    || ids.some(id => typeof id !== 'string' || !tracks.some(t => t.id === id))) {
    throw new MusicError(400, 'Order must contain every track exactly once.');
  }
  return ids.map(id => tracks.find(t => t.id === id)!);
}

// Require two consecutive MPEG Layer III frames, not just an extension or ID3 tag.
export function validateMp3(bytes: Uint8Array, filename: string) {
  if (!/\.mp3$/i.test(filename) || filename.length > 200 || /[\x00-\x1f]/.test(filename)) throw new MusicError(400, 'Choose an MP3 file.');
  if (!bytes.length || bytes.length > MAX_TRACK_BYTES) throw new MusicError(413, 'MP3 files must be between 1 byte and 20 MB.');
  let start = 0;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes.length < 10 || bytes.slice(6, 10).some(b => b > 127)) throw new MusicError(400, 'Invalid MP3 metadata.');
    start = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes[5] & 16) start += 10;
  }
  function frameLength(at: number) {
    const a = bytes[at + 1], b = bytes[at + 2];
    if (at + 4 > bytes.length || bytes[at] !== 255 || (a & 224) !== 224 || ((a >> 1) & 3) !== 1) return 0;
    const version = (a >> 3) & 3, rate = (b >> 2) & 3, bitrate = b >> 4;
    if (version === 1 || rate === 3 || bitrate === 0 || bitrate === 15) return 0;
    const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrate];
    const hz = [44100,48000,32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    return Math.floor((version === 3 ? 144000 : 72000) * kbps / hz) + ((b >> 1) & 1);
  }
  for (let at = start; at < Math.min(bytes.length - 4, start + 4096); at++) {
    const length = frameLength(at);
    const next = length && frameLength(at + length);
    if (next && at + length + next <= bytes.length) return;
  }
  throw new MusicError(400, 'The file does not contain valid MP3 audio.');
}

export function audioRange(header: string | null, size: number): { start: number; end: number; partial: boolean } {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new MusicError(416, 'Invalid byte range.');
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (![start,end].every(Number.isSafeInteger) || start < 0 || start >= size || end < start) throw new MusicError(416, 'Invalid byte range.');
  return { start, end, partial: true };
}
