// Local, in-memory company fixture. No database or credentials required.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {IndustryStructure} from './src/components/industry-tree';
    import CompanyGraph3D from './src/components/company-graph-3d';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    import {AuthProvider} from './src/components/providers/auth-provider';
    import {NavigationSettings} from './src/components/navigation-settings';
    import {UniverseMusic} from './src/components/universe-music';
    import graph from './data/ai-supply-chain/ai-us.json';
    const companies=graph.nodes.filter(n=>n.kind==='COMPANY');
    function App(){
      const [selected,select]=useState(''),[reset,setReset]=useState(0),[allEdges,setAllEdges]=useState(false);
      const [universe,setUniverse]=useState(new URLSearchParams(location.search).get('view')==='graph');
      const pick=id=>select(current=>current===id?'':id);
      return <LocaleProvider locale="en"><AuthProvider><main>
        <nav><a href="/" onClick={e=>{e.preventDefault();setUniverse(false);history.replaceState(null,'','/')}}>Tree preview</a> · <a href="/?view=graph" onClick={e=>{e.preventDefault();setUniverse(true);history.replaceState(null,'','/?view=graph')}}>Graph universe</a></nav>
        <h1>{universe?'Graph universe preview':'A more natural industry tree'}</h1>
        <p>{universe?'Local sample data · drag to orbit · scroll to zoom · select a company to explore its connections':'LOCAL DESIGN PREVIEW · Textured bark, organic branches and living green leaves · Drag to explore'}</p>
        <NavigationSettings/>
        <UniverseMusic/>
        {universe?<><label><input type="checkbox" checked={allEdges} onChange={e=>setAllEdges(e.target.checked)}/> Show all connections</label>
          <CompanyGraph3D musicControls graph={graph} selected={selected} onSelect={pick} cameraRequest={0} reset={reset} onReset={()=>{select('');setReset(n=>n+1)}} showAllEdges={allEdges}/>
          {selected&&<p>Selected: {graph.nodes.find(n=>n.id===selected)?.name} <button onClick={()=>select('')}>Clear selection</button></p>}
        </>:<IndustryStructure musicControls companies={companies} selected={selected} onSelect={pick} followedIds={[]} active vertical/>}
      </main></AuthProvider></LocaleProvider>}
    createRoot(document.getElementById('root')).render(<App/>);
  `}, bundle:true,write:false,outfile:'preview.js',platform:'browser',define:{'process.env':'{}'},
});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Natural tree · Local preview</title><style>body{margin:0;background:#08131d;color:#dceaf3;font:14px Arial}main{max-width:1600px;margin:auto;padding:16px}h1{font-size:24px;margin:12px 0}main>p{color:#a8b9a0;font-size:12px}nav a{color:#93b7aa}*{box-sizing:border-box}button,select{font:inherit}${css}[data-industry-section] [data-industry-tree="vertical"]{height:calc(100vh - 290px);min-height:380px}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
const port=Number(process.env.TREE_PREVIEW_PORT??3105);
createServer((req,res)=>{if(req.url==='/audio/blisters.mp3'){const audio=readFileSync('public/audio/blisters.mp3');res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length}).end(audio);return;}if(req.url==='/api/music'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({revision:'preview',tracks:[{id:'builtin-blisters',title:'Blisters',url:'/audio/blisters.mp3'}]}));return;}if(req.url?.startsWith('/flags/')){res.writeHead(204).end();return;}if(req.url?.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":null}');return;}res.writeHead(200,{'Content-Type':'text/html'}).end(html);}).listen(port,'127.0.0.1',()=>console.log(`Tree preview: http://127.0.0.1:${port}`));
