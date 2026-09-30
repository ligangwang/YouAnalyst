import { getAdminStorageBucket } from '@/lib/firebase/admin';
import { MusicError, initialTracks, type MusicPlaylist, type MusicTrack } from './model';

const manifestPath = 'site-music/playlist.json';
export const musicObjectPath = (id: string) => `site-music/tracks/${id}.mp3`;
export function musicBucket() {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const name = process.env.MUSIC_STORAGE_BUCKET?.trim() || (project ? `${project}-site-media-${process.env.APP_ENVIRONMENT === 'staging' ? 'staging' : 'production'}` : '');
  if (!name) throw new Error('Music storage is not configured');
  return getAdminStorageBucket(name);
}
export interface MusicStore {
  read(): Promise<MusicPlaylist>;
  save(tracks: MusicTrack[], revision: string): Promise<MusicPlaylist>;
  upload(id: string, bytes: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
const code = (error: unknown) => Number((error as { code?: unknown })?.code);
export const musicStore: MusicStore = {
  async read() {
    const bucket = musicBucket();
    for (let attempt = 0; attempt < 3; attempt++) {
      let revision: string;
      try {
        const [metadata] = await bucket.file(manifestPath).getMetadata();
        revision = String(metadata.generation);
      } catch (error) {
        if (code(error) === 404) return { revision: '0', tracks: structuredClone(initialTracks) };
        throw error;
      }
      try {
        const [contents] = await bucket.file(manifestPath, { generation: revision }).download();
        const manifest = JSON.parse(contents.toString('utf8')) as { tracks: MusicTrack[] };
        if (!Array.isArray(manifest.tracks)) throw new Error('Invalid music playlist');
        return { revision, tracks: manifest.tracks };
      } catch (error) { if (code(error) !== 404) throw error; }
    }
    throw new MusicError(409, 'The playlist changed. Reload and try again.');
  },
  async save(tracks, revision) {
    const file = musicBucket().file(manifestPath);
    try {
      await file.save(JSON.stringify({ tracks }), { resumable: false, contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: Number(revision) }, metadata: { cacheControl: 'no-store' } });
    } catch (error) {
      if (code(error) === 412) throw new MusicError(409, 'Another administrator changed the playlist. Reload and try again.');
      throw error;
    }
    // save() populates metadata from this exact upload response. A later read
    // could observe another editor's generation or fail after our write commits.
    if (!file.metadata.generation) throw new Error('Missing saved playlist generation');
    return { tracks, revision: String(file.metadata.generation) };
  },
  async upload(id, bytes) {
    await musicBucket().file(musicObjectPath(id)).save(bytes, { resumable: false, contentType: 'audio/mpeg',
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: 'public, max-age=3600' } });
  },
  async remove(id) { await musicBucket().file(musicObjectPath(id)).delete({ ignoreNotFound: true }); },
};
