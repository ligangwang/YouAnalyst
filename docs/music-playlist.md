# Background music playlist

Administrators can open **Admin → Background music** (`/admin/music`) to upload MP3s, preview tracks, change their order with the arrow buttons, and delete tracks. Uploads append to the playlist; each ordering or deletion action is saved immediately. Files are limited to 20 MB each, with a maximum of 100 tracks. The whole playlist repeats in order. An empty playlist is silent.

Graph and tree visitors retain the default-off sound preference and icon-only chart controls. Enabled players reload playlist metadata every minute and when the tab becomes visible. Reordering preserves the current track and uses the new order when it ends. Removing the current track advances playback to the first remaining playable track. Temporary metadata failures preserve the last working playlist; a failed audio file is skipped without endlessly retrying it.

## Storage and access

A private bucket configured by `MUSIC_STORAGE_BUCKET` stores `site-music/playlist.json` and `site-music/tracks/<uuid>.mp3`. No Firestore collection is created. The web runtime service account needs object read/create/update/delete permissions for that prefix (for example, a bucket-scoped `roles/storage.objectUser` grant with an appropriate prefix condition). The release script provisions `${GOOGLE_CLOUD_PROJECT}-site-media-${target}` with uniform bucket access and public access prevention, grants the existing web runtime object access, and passes the bucket name to Cloud Run. Production and staging use separate buckets. An explicit `MUSIC_STORAGE_BUCKET` can override the name; the caller must provision an existing custom bucket with the same privacy protections. No production resources are changed by the local preview.

Only authenticated admins can mutate `/api/admin/music`. MP3 extension, body size, and MPEG frame validation run server-side. Generation preconditions reject stale/concurrent edits with HTTP 409; reload the admin page before retrying. A failed object deletion offers a retry action after removing the track from the public playlist.

`/api/music` supplies public playlist metadata, and `/api/music/tracks/<uuid>` streams published audio through the app's domain with byte-range support. Visitors do not access Firebase or Google storage directly. Audio responses can be cached for an hour; removal stops advertising the track but is not a revocation of already downloaded public audio.

Until the first edit, a missing manifest uses the existing bundled Blisters track. Deleting it removes it from playback; the legacy bundled asset remains in the deployment artifact. Uploaded tracks are deleted from object storage. A deliberately empty manifest never restores the bundled track.

Deploy this feature once. Subsequent playlist edits are data changes and do not require deployment.

## Local preview

Run `node --import tsx scripts/music-preview.ts` and open `http://127.0.0.1:3108/admin/music`. This loopback-only preview uses a fake admin identity and in-memory storage; changes disappear when it stops and never touch production. The listener preview exercises the same playlist player.

Run `node --import tsx --test tests/analytics/music.test.ts` for validation, authorization, concurrency, deletion, range, and playback-order checks.
