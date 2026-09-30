import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { adminMusicResponse, limitedBody, publicMusicResponse } from '../../src/lib/music/http';
import { audioRange, BUILTIN_ID, initialTracks, MAX_TRACK_BYTES, MusicError, reorderTracks, trackUrl, validateMp3, type MusicPlaylist } from '../../src/lib/music/model';
import { nextTrackId, playbackTracks } from '../../src/lib/music/playback';
import type { MusicStore } from '../../src/lib/music/storage';

function fixture() {
  let playlist: MusicPlaylist = { revision: '0', tracks: structuredClone(initialTracks) };
  const files = new Map<string, Buffer>();
  let conflict = false;
  let failDelete = false;
  const store: MusicStore = {
    async read() { return structuredClone(playlist); },
    async save(tracks, revision) {
      if (conflict || revision !== playlist.revision) throw new MusicError(409, 'Conflict');
      playlist = { revision: String(Number(revision) + 1), tracks };
      return this.read();
    },
    async upload(id, bytes) { files.set(id, bytes); },
    async remove(id) { if (failDelete) throw new Error('storage unavailable'); files.delete(id); },
  };
  const deps = { store, authorize: async () => {} };
  const call = (method: string, query = '', body?: BodyInit, revision = playlist.revision) => adminMusicResponse(new NextRequest(`http://test/api/admin/music${query}`, {
    method, headers: { 'If-Match': revision, 'Content-Type': method === 'POST' ? 'audio/mpeg' : 'application/json' }, ...(body === undefined ? {} : { body }),
  }), deps);
  return { store, files, call, conflict: () => { conflict = true; }, failDelete: (value: boolean) => { failDelete = value; } };
}
const mp3 = () => {
  const buffer = Buffer.alloc(834);
  buffer.set([255,251,144,0],0); buffer.set([255,251,144,0],417);
  return new Uint8Array(buffer);
};

test('music: upload, reorder, delete and intentionally empty playlist persist', async () => {
  const f = fixture();
  let response = await f.call('POST', '?filename=Second.mp3', mp3());
  assert.equal(response.status, 201);
  let playlist = await response.json() as MusicPlaylist;
  const id = playlist.tracks[1].id;
  assert.equal(f.files.size, 1);
  response = await f.call('PATCH', '', JSON.stringify({ ids: [id, BUILTIN_ID] }));
  playlist = await response.json();
  assert.deepEqual(playlist.tracks.map(t => t.id), [id, BUILTIN_ID]);
  response = await f.call('DELETE', `?id=${id}`);
  assert.equal(response.status, 200); assert.equal(f.files.size, 0);
  await f.call('DELETE', `?id=${BUILTIN_ID}`);
  const published = await (await publicMusicResponse(f.store)).json();
  assert.deepEqual(published.tracks, []);
});

test('music: authenticate before touching storage or reading upload body', async () => {
  for (const status of [401,403]) {
    const f = fixture();
    f.store.read = async () => { throw new Error('must not read storage'); };
    const result = await adminMusicResponse(new NextRequest('http://test/api/admin/music', { method: 'POST', body: mp3() }), {
      store: f.store, authorize: async () => { throw new MusicError(status, 'denied'); },
    });
    assert.equal(result.status, status); assert.equal(f.files.size, 0);
  }
});

test('music: reject stale edits and clean uploaded object after concurrent publication conflict', async () => {
  const f = fixture();
  assert.equal((await f.call('DELETE', `?id=${BUILTIN_ID}`, undefined, '9')).status, 409);
  f.conflict();
  assert.equal((await f.call('POST', '?filename=test.mp3', mp3())).status, 409);
  assert.equal(f.files.size, 0);
  assert.deepEqual((await f.store.read()).tracks, initialTracks);
});

test('music: deletion can be retried after object storage fails', async () => {
  const f = fixture();
  const uploaded = await (await f.call('POST', '?filename=test.mp3', mp3())).json() as MusicPlaylist;
  const id = uploaded.tracks[1].id;
  f.failDelete(true);
  const result = await (await f.call('DELETE', `?id=${id}`)).json();
  assert.equal(result.cleanupPending, id);
  assert.equal((await f.store.read()).tracks.length, 1);
  // Another editor publishes a new order while object cleanup is pending.
  await f.call('PATCH', '', JSON.stringify({ ids: [BUILTIN_ID] }));
  const concurrent = await f.store.read();
  f.failDelete(false);
  assert.equal((await f.call('DELETE', `?id=${id}`, undefined, result.revision)).status, 200);
  assert.deepEqual(await f.store.read(), concurrent);
  assert.equal(f.files.size, 0);
});

test('music: an ambiguous publication error never removes an already published upload', async () => {
  const f = fixture();
  const save = f.store.save.bind(f.store);
  f.store.save = async (tracks, revision) => { await save(tracks, revision); throw new MusicError(409, 'Response lost after publication'); };
  assert.equal((await f.call('POST', '?filename=test.mp3', mp3())).status, 409);
  assert.equal((await f.store.read()).tracks.length, 2);
  assert.equal(f.files.size, 1);
});

test('music: only exact reorder permutations and bounded valid MP3 uploads are accepted', async () => {
  assert.throws(() => reorderTracks(initialTracks, []), MusicError);
  assert.throws(() => reorderTracks(initialTracks, ['unknown']), MusicError);
  const f = fixture();
  assert.equal((await f.call('PATCH', '', 'null')).status, 400);
  assert.equal((await f.call('POST', '?filename=bad.mp3', 'not audio')).status, 400);
  assert.equal((await f.call('DELETE', '?id=..%2Fprivate')).status, 400);
  assert.throws(() => validateMp3(mp3(), 'bad.html'), MusicError);
  assert.throws(() => validateMp3(new Uint8Array([73,68,51,4,0,0,0,0,0,0]), 'fake.mp3'), MusicError);
  validateMp3(mp3(), 'valid.mp3');
  validateMp3(await readFile('public/audio/blisters.mp3'), 'blisters.mp3');
  await assert.rejects(limitedBody(new Request('http://test', {method:'POST', body:'12345'}), 4), MusicError);
  await assert.rejects(limitedBody(new Request('http://test', {method:'POST',headers:{'Content-Length':String(MAX_TRACK_BYTES+1)},body:'x'}), MAX_TRACK_BYTES), MusicError);
});

test('music: ranges support seeking and suffixes, rejecting invalid/multiple ranges', () => {
  assert.deepEqual(audioRange(null, 1000), { start:0,end:999,partial:false });
  assert.deepEqual(audioRange('bytes=100-199',1000), { start:100,end:199,partial:true });
  assert.deepEqual(audioRange('bytes=900-',1000), { start:900,end:999,partial:true });
  assert.deepEqual(audioRange('bytes=-20',1000), { start:980,end:999,partial:true });
  for (const range of ['bytes=1000-', 'bytes=-0', 'bytes=5-2', 'bytes=0-1,4-5', 'bytes=-']) assert.throws(() => audioRange(range,1000), MusicError);
});

test('music: repeat uses latest order, skips failed tracks, and stops on empty/all-failed playlists', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const tracks = [BUILTIN_ID,id].map(id => ({id,title:id,url:trackUrl(id)}));
  assert.equal(nextTrackId(tracks,BUILTIN_ID),id);
  assert.equal(nextTrackId(tracks,id),BUILTIN_ID);
  assert.equal(nextTrackId(tracks,id,new Set([BUILTIN_ID])),id);
  assert.equal(nextTrackId(tracks,id,new Set([BUILTIN_ID,id])),null);
  assert.equal(nextTrackId([],id),null);
  assert.equal(nextTrackId([tracks[0]],BUILTIN_ID),BUILTIN_ID);
  assert.equal(playbackTracks([{...tracks[0],url:'https://other.example/song.mp3'}]),null);
  assert.equal(playbackTracks([tracks[0],tracks[0]]),null);
  assert.deepEqual(playbackTracks(tracks),tracks);
});
