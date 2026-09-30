import { trackUrl, validTrackId } from './model';
export type PlaybackTrack = { id: string; title: string; url: string };
export function playbackTracks(input: unknown): PlaybackTrack[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const seen = new Set<string>();
  for (const track of input) {
    if (!track || typeof track.id !== 'string' || !validTrackId(track.id) || seen.has(track.id)
      || typeof track.title !== 'string' || track.url !== trackUrl(track.id)) return null;
    seen.add(track.id);
  }
  return input;
}
export function nextTrackId(tracks: PlaybackTrack[], current: string | null, failed: ReadonlySet<string> = new Set()): string | null {
  const index = tracks.findIndex(t => t.id === current);
  for (let step = 1; step <= tracks.length; step++) {
    const track = tracks[(index + step) % tracks.length];
    if (!failed.has(track.id)) return track.id;
  }
  return null;
}
