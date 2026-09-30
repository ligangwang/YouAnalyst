import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { adminMusicResponse, publicMusicResponse } from '../../src/lib/music/http';
import { initialTracks, MusicError, type MusicPlaylist } from '../../src/lib/music/model';
import type { MusicStore } from '../../src/lib/music/storage';

let html: string;
const mp3 = readFileSync('public/audio/blisters.mp3');
test.beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader:'tsx', contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AdminMusicPage} from './src/components/admin-music-page';
    import {UniverseMusic,UniverseMusicToggle} from './src/components/universe-music';
    createRoot(document.getElementById('root')).render(<><AdminMusicPage/><section className="listener" style={{position:'relative',minHeight:160}}><UniverseMusic/><UniverseMusicToggle/></section></>);
  ` }, bundle:true,write:false,outfile:'music.js',platform:'browser',define:{'process.env':'{}'},plugins:[{name:'fixtures',setup(b){
    b.onResolve({filter:/providers\/auth-provider$/},()=>({path:'auth',namespace:'fixture'}));
    b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({resolveDir:process.cwd(),loader:'tsx',contents:path==='auth'
      ? `const getIdToken=async()=>"admin";export const useAuth=()=>({getIdToken});`
      : `import React from 'react';export default props=><a {...props}/>;`}));
  }}] });
  html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#08131d;margin:0}${result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
});

test('admin uploads, orders and deletes tracks; listener repeats and stops when empty',async({page})=>{
  let playlist: MusicPlaylist = {revision:'0',tracks:structuredClone(initialTracks)};
  const files=new Map<string,Buffer>();
  const store: MusicStore={
    async read(){return structuredClone(playlist);},
    async save(tracks,revision){if(revision!==playlist.revision)throw new MusicError(409,'Conflict');playlist={revision:String(Number(revision)+1),tracks};return this.read();},
    async upload(id,bytes){files.set(id,bytes);},async remove(id){files.delete(id);},
  };
  await page.clock.install();
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/admin/music'){
      const response=await adminMusicResponse(new NextRequest(req.url(),{method:req.method(),headers:req.headers(),...(req.postDataBuffer()?{body:new Uint8Array(req.postDataBuffer()!)}:{})}),{
        store,authorize:async r=>{if(r.headers.get('authorization')!=='Bearer admin')throw new MusicError(403,'Forbidden');},
      });
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});return;
    }
    if(url.pathname==='/api/music'){const response=await publicMusicResponse(store);await route.fulfill({contentType:'application/json',body:await response.text()});return;}
    if(url.pathname.startsWith('/audio/')||url.pathname.startsWith('/api/music/tracks/')){await route.fulfill({contentType:'audio/mpeg',body:mp3});return;}
    await route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://music.test/admin/music');
  await expect(page.getByRole('heading',{name:'Playlist (1)',exact:true})).toBeVisible();
  const audio=page.locator('.listener audio');
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.getByLabel('Add MP3 files',{exact:true}).setInputFiles([
    {name:'Second.mp3',mimeType:'audio/mpeg',buffer:mp3},
    {name:'Third.mp3',mimeType:'audio/mpeg',buffer:mp3},
  ]);
  await expect(page.getByRole('heading',{name:'Playlist (3)',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Move Third up',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Move Third up',exact:true}).click();
  await expect(page.locator('main li strong')).toHaveText(['Blisters','Third','Second']);
  await page.clock.fastForward(60000);
  await page.getByRole('button',{name:'Unmute music',exact:true}).click();
  await expect(page.getByRole('button',{name:'Mute music',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.loop)).toBe(false);
  const ids=playlist.tracks.map(t=>t.id);
  // A natural media-ended event should follow the saved order and wrap to the start.
  await audio.evaluate(a=>a.dispatchEvent(new Event('ended')));
  await expect(audio).toHaveAttribute('src',`/api/music/tracks/${ids[1]}`);
  await audio.evaluate(a=>a.dispatchEvent(new Event('ended')));
  await expect(audio).toHaveAttribute('src',`/api/music/tracks/${ids[2]}`);
  await audio.evaluate(a=>a.dispatchEvent(new Event('ended')));
  await expect(audio).toHaveAttribute('src','/audio/blisters.mp3');
  for(const title of ['Third','Second','Blisters']){
    await page.getByRole('button',{name:`Delete ${title}`,exact:true}).click();
    await page.getByRole('button',{name:'Confirm delete',exact:true}).click();
    await expect(page.getByRole('button',{name:'Reload',exact:true})).toBeEnabled();
  }
  await expect(page.getByRole('heading',{name:'Playlist (0)',exact:true})).toBeVisible();
  expect(files.size).toBe(0);
  await page.clock.fastForward(60000);
  await expect(audio).not.toHaveAttribute('src',/./);
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Playlist (0)',exact:true})).toBeVisible();
});
