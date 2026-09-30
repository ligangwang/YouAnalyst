// Loopback-only, in-memory preview. No production credentials, buckets, or user data.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { adminMusicResponse, publicMusicResponse } from '../src/lib/music/http';
import { audioRange, initialTracks, MusicError, type MusicPlaylist } from '../src/lib/music/model';
import type { MusicStore } from '../src/lib/music/storage';

async function main() {
let playlist: MusicPlaylist = { revision: '0', tracks: structuredClone(initialTracks) };
const files = new Map<string, Buffer>();
const store: MusicStore = {
  async read() { return structuredClone(playlist); },
  async save(tracks, revision) {
    if (revision !== playlist.revision) throw new MusicError(409, 'Playlist changed. Reload.');
    playlist = { revision: String(Number(revision) + 1), tracks };
    return this.read();
  },
  async upload(id, bytes) { files.set(id, bytes); },
  async remove(id) { files.delete(id); },
};
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {AdminMusicPage} from './src/components/admin-music-page';
  import {UniverseMusic,UniverseMusicToggle} from './src/components/universe-music';
  import {LocaleProvider} from './src/components/providers/locale-provider';
  createRoot(document.getElementById('root')).render(<LocaleProvider locale="en">
    <div className="preview-note">LOCAL PREVIEW · Changes are held in memory and do not affect the live site.</div>
    <AdminMusicPage/>
    <section className="listener"><h2>Listener preview</h2><p>Enable sound here to hear the repeating playlist. Updates arrive within one minute.</p><UniverseMusic/><UniverseMusicToggle/></section>
  </LocaleProvider>);
` }, bundle: true, write: false, outfile: 'music-preview.js', platform: 'browser', define: { 'process.env': '{}' },
  plugins: [{ name: 'preview-auth', setup(b) {
    b.onResolve({ filter: /providers\/auth-provider$/ }, () => ({ path: 'auth', namespace: 'preview' }));
    b.onLoad({ filter: /.*/, namespace: 'preview' }, () => ({ contents: `const getIdToken=async()=>"local-preview"; export const useAuth=()=>({getIdToken,user:{uid:"preview"},loading:false});`, loader: 'js' }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'preview-link' }));
    b.onLoad({ filter: /.*/, namespace: 'preview-link' }, () => ({ contents: `import React from 'react'; export default function Link(props){return <a {...props}/>}`, loader: 'tsx', resolveDir: process.cwd() }));
  } }],
});
const js = bundle.outputFiles.find(f => f.path.endsWith('.js'))!.text.replaceAll('</script', '<\\/script');
const css = bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '';
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Music admin · Local preview</title><style>body{margin:0;background:#08131d;color:#dceaf3;font:14px Arial}*{box-sizing:border-box}button,input{font:inherit}.preview-note{padding:14px 24px;background:#12312f;color:#b0e3d5;font-size:12px}.listener{position:relative;max-width:960px;margin:0 auto 40px;padding:24px 80px 60px 24px;min-height:180px;border:1px solid #37565c;border-radius:16px;background:#0c1a2b}${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
const port = Number(process.env.MUSIC_PREVIEW_PORT ?? 3108);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/admin/music') {
      const method = req.method ?? 'GET';
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new NextRequest(url, { method, headers, ...(method === 'GET' ? {} : { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' }) });
      const response = await adminMusicResponse(request, { store, authorize: async r => { if (r.headers.get('authorization') !== 'Bearer local-preview') throw new MusicError(401, 'Preview authorization required'); } });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (url.pathname === '/api/music') {
      const response = await publicMusicResponse(store);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text()); return;
    }
    if (url.pathname === '/audio/blisters.mp3' || url.pathname.startsWith('/api/music/tracks/')) {
      const bytes = url.pathname === '/audio/blisters.mp3' ? await readFile('public/audio/blisters.mp3') : files.get(url.pathname.split('/').at(-1)!);
      if (!bytes) { res.writeHead(404).end(); return; }
      const range = audioRange(req.headers.range ?? null, bytes.length);
      res.writeHead(range.partial ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Content-Length': range.end - range.start + 1, 'Accept-Ranges':'bytes', ...(range.partial ? { 'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}` } : {}) });
      res.end(bytes.subarray(range.start, range.end + 1)); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
  } catch (error) { res.writeHead(error instanceof MusicError ? error.status : 500).end('Preview request failed'); }
}).listen(port, '127.0.0.1', () => console.log(`Music admin preview: http://127.0.0.1:${port}/admin/music`));

}
void main();
