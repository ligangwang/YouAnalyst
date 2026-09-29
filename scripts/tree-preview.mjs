// Local, in-memory company fixture. No database or credentials required.
import { build } from 'esbuild';
import { createServer } from 'node:http';
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {IndustryStructure} from './src/components/industry-tree';
    import CompanyGraph3D from './src/components/company-graph-3d';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    import {NavigationSettings} from './src/components/navigation-settings';
    import graph from './data/ai-supply-chain/ai-us.json';
    const ids=['US:CEG','US:NVDA','US:AMD','US:MSFT','US:GOOGL','US:AMZN','US:META','US:PLTR'];
    const companies=graph.nodes.filter(n=>ids.includes(n.id));
    companies.push({id:'DEMO:CHIP',kind:'COMPANY',name:'Sample Chip Company',symbol:'DEMO',market:'GLOBAL',country:'US',stageIds:['compute'],sourceIds:[],order:1000});
    function App(){
      const [selected,select]=useState(''),[reset,setReset]=useState(0),[allEdges,setAllEdges]=useState(false);
      const universe=new URLSearchParams(location.search).get('view')==='graph';
      const pick=id=>select(current=>current===id?'':id);
      return <LocaleProvider locale="en"><main>
        <nav><a href="/">Tree preview</a> · <a href="/?view=graph">Graph universe</a></nav>
        <h1>{universe?'Graph universe preview':'Tree navigation preview'}</h1>
        <p>{universe?'Local sample data · drag to orbit · scroll to zoom · select a company to explore its connections':'Local sample companies · scroll to zoom, right-drag to rotate · tour resumes after two seconds'}</p>
        <NavigationSettings/>
        {universe?<><label><input type="checkbox" checked={allEdges} onChange={e=>setAllEdges(e.target.checked)}/> Show all connections</label>
          <CompanyGraph3D graph={graph} selected={selected} onSelect={pick} cameraRequest={0} reset={reset} onReset={()=>{select('');setReset(n=>n+1)}} showAllEdges={allEdges}/>
          {selected&&<p>Selected: {graph.nodes.find(n=>n.id===selected)?.name} <button onClick={()=>select('')}>Clear selection</button></p>}
        </>:<IndustryStructure companies={companies} selected={selected} onSelect={pick} followedIds={[]} active vertical/>}
      </main></LocaleProvider>}
    createRoot(document.getElementById('root')).render(<App/>);
  `}, bundle:true,write:false,outfile:'preview.js',platform:'browser',define:{'process.env':'{}'},
});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script');
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tree navigation preview</title><style>body{margin:0;background:#08131d;color:#dceaf3;font:16px Arial}main{max-width:1400px;margin:auto;padding:20px}*{box-sizing:border-box}button,select{font:inherit}${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
const port=Number(process.env.TREE_PREVIEW_PORT??3105);
createServer((req,res)=>{if(req.url?.startsWith('/flags/')){res.writeHead(204).end();return;}if(req.url?.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":null}');return;}res.writeHead(200,{'Content-Type':'text/html'}).end(html);}).listen(port,'127.0.0.1',()=>console.log(`Tree preview: http://127.0.0.1:${port}`));
