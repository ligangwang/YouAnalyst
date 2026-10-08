import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { renderToPipeableStream } from 'react-dom/server';
import { initialSnapshotWithinBudget } from '../../src/lib/intelligence/initial-snapshot';

async function pageWithSnapshot(load:()=>Promise<unknown>,budget=100){
  const external=['@/components/live-investment-intelligence','@/components/intelligence-loading-shell','@/lib/intelligence/service','@/lib/intelligence/initial-snapshot','@/lib/i18n/server'];
  const result=await build({entryPoints:['src/app/intelligence/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external,jsx:'automatic'});
  const realRequire=createRequire(import.meta.url),evaluated={exports:{}};
  const injected=(name:string)=>{
    if(name==='@/components/live-investment-intelligence')return {LiveInvestmentIntelligence:(props:{initialSnapshot?:unknown;initialTheme:string;initialCompany:string})=><div data-theme={props.initialTheme} data-company={props.initialCompany}>{props.initialSnapshot?'Loaded snapshot':'Client API loader'}</div>};
    if(name==='@/components/intelligence-loading-shell')return {IntelligenceLoadingShell:()=> <main>Loading companies and recorded events…</main>};
    if(name==='@/lib/intelligence/service')return {loadIntelligenceSnapshot:load};
    if(name==='@/lib/intelligence/initial-snapshot')return {initialSnapshotWithinBudget:(request:Promise<unknown>)=>initialSnapshotWithinBudget(request,budget)};
    if(name==='@/lib/i18n/server')return {localizedMetadata:async()=>({})};
    return realRequire(name);
  };
  new Function('require','module','exports',result.outputFiles[0].text)(injected,evaluated,evaluated.exports);
  const Page=(evaluated.exports as {default:(props:{searchParams:Promise<Record<string,string>>})=>Promise<React.ReactNode>}).default;
  return await Page({searchParams:Promise.resolve({theme:'robotics',company:'US:NVDA',view:'graph'})});
}

function streamPage(node:React.ReactNode){
  let html='';
  let shellResolve:()=>void,endResolve:()=>void;
  const shell=new Promise<void>(resolve=>{shellResolve=resolve;});
  const done=new Promise<void>(resolve=>{endResolve=resolve;});
  const output=new Writable({write(chunk,_encoding,callback){html+=chunk.toString();shellResolve();callback();},final(callback){endResolve();callback();}});
  const stream=renderToPipeableStream(<html><body><header>YouAnalyst</header>{node}</body></html>,{onShellReady(){stream.pipe(output);},onError(error){assert.fail(String(error));}});
  return {shell,done,html:()=>html,abort:()=>stream.abort()};
}

test('homepage streams its shell before a delayed snapshot and preserves selected theme/company',async()=>{
  let resolveSnapshot!:(value:unknown)=>void;
  const request=new Promise(resolve=>{resolveSnapshot=resolve;});
  const rendered=streamPage(await pageWithSnapshot(()=>request,1000));
  await rendered.shell;
  assert.match(rendered.html(),/Loading companies and recorded events/);
  assert.doesNotMatch(rendered.html(),/Loaded snapshot/);
  resolveSnapshot({graphVersion:'real'});
  await rendered.done;
  assert.match(rendered.html(),/Loaded snapshot/);
  assert.match(rendered.html(),/data-theme="robotics"/);
  assert.match(rendered.html(),/data-company="US:NVDA"/);
});

test('a stalled snapshot finishes HTML with the existing API loader instead of holding the page open',async()=>{
  const rendered=streamPage(await pageWithSnapshot(()=>new Promise(()=>{}),25));
  await rendered.shell;await rendered.done;
  assert.match(rendered.html(),/Client API loader/);
});

test('snapshot errors fall back safely and late rejections after the budget are handled',async()=>{
  assert.equal(await initialSnapshotWithinBudget(Promise.reject(new Error('Unavailable')),25),undefined);
  let reject!:(error:Error)=>void;
  const request=new Promise((_resolve,rejectRequest)=>{reject=rejectRequest;});
  assert.equal(await initialSnapshotWithinBudget(request,5),undefined);
  reject(new Error('Late failure'));
  await new Promise(resolve=>setImmediate(resolve));
});
