import { readFileSync } from "node:fs";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { build } from "esbuild";
import { PerspectiveCamera, Vector3 } from "three";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { companySector, GRAPH_SECTORS } from "../../src/lib/knowledge-graph/sectors";
import { layout3D } from "../../src/lib/knowledge-graph/layout-3d";
import { layoutCompanies } from "../../src/lib/knowledge-graph/constellation";

async function expectGraphEmphasis(label: Locator, expected: number) {
 // A culled label fades to zero; its emphasis must still be restored when it returns.
 await expect.poll(()=>label.evaluate((el, expected)=>{
   const style=getComputedStyle(el), visible=(el as HTMLElement).dataset.visible==='true';
   return [Number(style.getPropertyValue('--label-emphasis')||1),Number(style.opacity)===(visible?expected:0)];
 },expected)).toEqual([expected,true]);
}
async function revealMapSearch(page:Page) {
 const graphTab=page.getByRole('tab',{name:/^(Relationship graph|关系图谱)$/});
 if(await graphTab.getAttribute('aria-selected')!=='true') return;
 const button=page.getByRole('button',{name:/^(Find company|查找公司)$/});
 await expect(button).toBeVisible();
 if(await button.getAttribute('aria-expanded')==='false') await button.click();
}
async function revealListFilters(page:Page) {
 const button=page.getByRole('button',{name:/^(Filters|筛选)/});
 if(await button.isVisible() && await button.getAttribute('aria-expanded')==='false') await button.click();
}
const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
test('tree camera tour pauses on hold and resumes from the released view',async({page,isMobile})=>{
 test.setTimeout(90000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const tree=page.getByRole('region',{name:'Vertical tree',exact:true}),canvas=tree.locator('canvas');
 await canvas.scrollIntoViewIfNeeded();
 await expect(canvas).toHaveAttribute('data-tour','paused');
 await expect(tree.locator('[data-tree-company]').first()).toBeAttached();
 const positions=()=>tree.locator('[data-tree-company]').evaluateAll(els=>els.slice(0,8).map(e=>e.parentElement?.parentElement?.parentElement?.style.transform));
 await expect.poll(async()=>(await positions()).every(p=>p?.includes('translate3d'))).toBe(true);
 const initial=await positions();
 await page.waitForTimeout(400);
 expect(await positions()).toEqual(initial);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect(canvas).toHaveAttribute('data-tour','playing');
 await expect.poll(positions).not.toEqual(initial);
 await page.waitForTimeout(14000);
 await page.screenshot({path:`output/tree-tour-${test.info().project.name}.png`});
 await expect(tree.locator('[data-tree-company][data-compact="false"]').first()).toBeVisible({timeout:45000});
 await page.screenshot({path:`output/tree-tour-${test.info().project.name}.png`});
 const bounds=(await canvas.boundingBox())!;
 const pose=()=>canvas.evaluate(el=>[...(el.getAttribute('data-camera-position')??'').split(','),...(el.getAttribute('data-camera-target')??'').split(',')].map(Number));
 await page.mouse.move(bounds.x+8,bounds.y+8);
 await page.mouse.down({button:'right'});
 await page.mouse.move(bounds.x+58,bounds.y+28,{steps:8});
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const held=await pose();
 expect(held).toHaveLength(6);
 expect(held.every(Number.isFinite)).toBe(true);
 await page.waitForTimeout(2300);
 expect(await pose()).toEqual(held);
 await page.mouse.up({button:'right'});
 await page.waitForTimeout(600);
 expect(await pose()).toEqual(held);
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 await expect.poll(pose,{timeout:10000}).not.toEqual(held);
 // Pan and zoom, then observe the first resumed frame in the page itself.
 await page.mouse.move(bounds.x+8,bounds.y+8);
 await zoomWheel(page,-120);
 await page.mouse.down();
 await page.mouse.move(bounds.x+38,bounds.y+28,{steps:6});
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const manual=await pose();
 expect(manual).not.toEqual(held);
 await canvas.evaluate(el=>{
   el.removeAttribute('data-first-resumed-pose');
   const observer=new MutationObserver(()=>{
     if(el.getAttribute('data-tour')==='playing'){
       el.setAttribute('data-first-resumed-pose',[el.getAttribute('data-camera-position'),el.getAttribute('data-camera-target')].join(','));observer.disconnect();
     }
   });
   observer.observe(el,{attributes:true,attributeFilter:['data-tour']});
 });
 await page.mouse.up();
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 const first=(await canvas.getAttribute('data-first-resumed-pose'))!.split(',').map(Number);
 expect(Math.max(...first.map((v,i)=>Math.abs(v-manual[i])))).toBeLessThan(.01);
 await expect.poll(pose,{timeout:10000}).not.toEqual(manual);
 // Mobile touch and mouse click both pause an already resumed tour.
 if(isMobile)await page.touchscreen.tap(bounds.x+8,bounds.y+8);
 else await page.mouse.click(bounds.x+8,bounds.y+8);
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await page.waitForTimeout(2300);
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();
 await canvas.scrollIntoViewIfNeeded();
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 await page.emulateMedia({reducedMotion:'reduce'});
 const returnedBounds=(await canvas.boundingBox())!;
 if(isMobile)await page.touchscreen.tap(returnedBounds.x+8,returnedBounds.y+8);
 else await page.mouse.click(returnedBounds.x+8,returnedBounds.y+8);
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const reduced=await pose();
 await page.waitForTimeout(2300);
 expect(await pose()).toEqual(reduced);
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 // A selected company must keep an otherwise ready-to-resume tour paused.
 const company=tree.locator('[data-tree-company="US:NVDA"]').first();
 await company.evaluate((el:HTMLButtonElement)=>el.click());
 await expect(company).toHaveAttribute('aria-pressed','true');
 await canvas.scrollIntoViewIfNeeded();
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const selected=await pose();
 await page.waitForTimeout(2300);
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 expect(await pose()).toEqual(selected);
 await tree.getByRole('button',{name:'Close company details',exact:true}).click();
 await expect(tree.getByRole('dialog',{name:'Company details'})).toHaveCount(0);
 await page.waitForTimeout(500);
 expect(await pose()).toEqual(selected);
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 await expect.poll(pose,{timeout:10000}).not.toEqual(selected);
});
async function projectedGraphPositions(page: Page) {
 // Drei's outer Html wrapper holds the projected node position. Label bounds also
 // include font-size easing and collision offsets, which can settle after camera sleep.
 return page.locator('[data-company-id]').evaluateAll(els=>els.flatMap(el=>{
   const transform=el.parentElement!.parentElement!.style.transform;
   if(!transform.includes('translate3d')) throw new Error('Missing projected graph position');
   const matrix=new DOMMatrixReadOnly(transform);
   return [matrix.m41,matrix.m42];
 }));
}

test('closing graph details resumes rotation and the card stays beside its node',async({page})=>{
 test.setTimeout(45000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph');
 const canvas=page.locator('canvas');
 await canvas.scrollIntoViewIfNeeded();
 const node=page.locator('[data-company-id="US:NVDA"]');
 await node.evaluate((el:HTMLButtonElement)=>el.click());
 const card=page.locator('[data-node-card="US:NVDA"]');
 await expect(card).toBeVisible();
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 await expect.poll(()=>card.evaluate(el=>{
   const c=el.getBoundingClientRect(),n=document.querySelector('[data-company-id="US:NVDA"]')!.getBoundingClientRect();
   return Math.hypot(Math.max(n.left-c.right,c.left-n.right,0),Math.max(n.top-c.bottom,c.top-n.bottom,0));
 })).toBeLessThan(30);
 expect(await card.evaluate(el=>{
   const r=el.getBoundingClientRect();
   return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.left+20,r.top+20));
 })).toBe(true);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect(canvas).toHaveAttribute('data-rotation','focused');
 await card.getByRole('button',{name:'Clear selection'}).click();
 await expect(card).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-rotation','waiting');
 const before=await projectedGraphPositions(page);
 await page.waitForTimeout(500);
 // Html projection can settle by fractions of a CSS pixel after camera rest.
 // Reject a visible jump while the rotation state independently verifies the pause.
 expect(Math.max(...(await projectedGraphPositions(page)).map((v,i)=>Math.abs(v-before[i])))).toBeLessThan(.5);
 await expect(canvas).toHaveAttribute('data-rotation','waiting');
 await expect(canvas).toHaveAttribute('data-rotation','resumed',{timeout:5000});
 await expect.poll(async()=>{const after=await projectedGraphPositions(page);return after.some((v,i)=>Math.abs(v-before[i])>1);},{timeout:10000}).toBe(true);
});

test('tree layer changes preserve the camera and navigation skips closed layers',async({page})=>{
 test.setTimeout(45000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const tree=page.getByRole('region',{name:'Vertical tree',exact:true}),canvas=tree.locator('canvas');
 await canvas.scrollIntoViewIfNeeded();
 await expect(canvas).toHaveAttribute('data-camera','idle');
 const pose=()=>canvas.evaluate(el=>[el.getAttribute('data-camera-position'),el.getAttribute('data-camera-target')].join(','));
 const initial=await pose();
 await tree.locator('[data-tree-kind="layer"][data-tree-node="energy"]').evaluate((el:HTMLButtonElement)=>el.click());
 await expect(canvas).not.toHaveAttribute('data-tour-open-layers',/energy/);
 expect(await pose()).toEqual(initial);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 await expect(canvas).toHaveAttribute('data-tour-layer','chips');
 await expect.poll(pose,{timeout:10000}).not.toEqual(initial);
 await tree.getByRole('button',{name:'Collapse all',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-tour-open-layers','');
 await expect(canvas).toHaveAttribute('data-tour','stopped');
 const collapsed=await pose();
 await page.waitForTimeout(2300);
 expect(await pose()).toEqual(collapsed);
 // Observe in the page: on a slow mobile renderer, a click can return after resumption.
 await canvas.evaluate(el=>{
   el.removeAttribute('data-reopened-pose');
   const observer=new MutationObserver(()=>{
     if(el.getAttribute('data-tour')==='playing'){
       el.setAttribute('data-reopened-pose',[el.getAttribute('data-camera-position'),el.getAttribute('data-camera-target')].join(','));observer.disconnect();
     }
   });
   observer.observe(el,{attributes:true,attributeFilter:['data-tour']});
 });
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 await canvas.scrollIntoViewIfNeeded();
 await expect(canvas).toHaveAttribute('data-tour','playing',{timeout:5000});
 const reopened=(await canvas.getAttribute('data-reopened-pose'))!.split(',').map(Number),previous=collapsed.split(',').map(Number);
 expect(Math.max(...reopened.map((v,i)=>Math.abs(v-previous[i])))).toBeLessThan(.01);
 await expect.poll(pose,{timeout:10000}).not.toEqual(collapsed);
 // The card must win hit testing over projected Html node labels.
 await page.emulateMedia({reducedMotion:'reduce'});
 await tree.locator('[data-tree-company="US:GEV"]').first().evaluate((el:HTMLButtonElement)=>el.click());
 const card=tree.getByRole('dialog',{name:'Company details'});
 await expect(card).toHaveAttribute('data-node-card','US:GEV');
 expect(await card.evaluate(el=>{
   const r=el.getBoundingClientRect();
   return [30,r.height/2,r.height-30].every(y=>el.contains(document.elementFromPoint(r.left+r.width/2,r.top+y)));
 })).toBe(true);
});
test('background follow status does not cancel the opening camera', async ({page}) => {
 test.setTimeout(45000);
 await page.emulateMedia({reducedMotion:'reduce'});
 let releaseFollows!: () => void;
 const followsReady = new Promise<void>(resolve => { releaseFollows = resolve; });
 await page.route('**/*', async route => {
   const url = new URL(route.request().url());
   if(url.pathname === '/api/knowledge-graph') return route.fulfill({json:graph});
   if(url.pathname === '/api/map-follows') {
     await followsReady;
     return route.fulfill({json:{companyIds:['US:NVDA']}});
   }
   return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://graph.test/map?account&lang=en&view=graph');
 const canvas=page.locator('canvas');
 await expect(page.locator('[data-company-id]')).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
 await expect(canvas).toHaveAttribute('data-camera','idle');
 const response=page.waitForResponse('**/api/map-follows');
 releaseFollows();
 await (await response).finished();
 // Let React apply the follow response while motion is disabled, so a camera
 // reframe cannot be mistaken for the introduction starting.
 await page.waitForTimeout(500);
 const before=await projectedGraphPositions(page);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect.poll(async()=>{
   const after=await projectedGraphPositions(page);
   return after.some((v,i)=>Math.abs(v-before[i])>1);
 },{timeout:15000}).toBe(true);
});

test('cinematic introduction and reset replay approach and rotation until touched', async ({page, isMobile}) => {
 test.setTimeout(150000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph');
 const labels=page.locator('[data-company-id]');
 const canvas=page.locator('canvas');
 await expect(labels).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
 await expect(canvas).toHaveAttribute('data-camera','idle');
 const averageScale=()=>labels.evaluateAll(els=>els.reduce((sum,el)=>sum+Number((el as HTMLElement).style.getPropertyValue('--label-scale')),0)/els.length);
 const before=await averageScale();
 await page.emulateMedia({reducedMotion:'no-preference'});
 // Watch the automatic camera, not just a user drag: labels used to change
 // sides abruptly here when collision priority changed during the orbit.
 const stability=await page.evaluate(()=>new Promise<{sideChanges:string[];earlyReturns:string[];samples:number}>(resolve=>{
   const sides=new Map<string,string>(),visibility=new Map<string,boolean>(),exits=new Map<string,number>();
   const sideChanges=new Set<string>(),earlyReturns=new Set<string>(),start=performance.now();
   let samples=0;
   const sample=()=>{
     const now=performance.now();samples++;
     document.querySelectorAll<HTMLElement>('[data-company-id]').forEach(el=>{
       const id=el.dataset.companyId!,x=el.style.getPropertyValue('--label-offset-x'),y=el.style.getPropertyValue('--label-offset-y');
       if(x && y){
         const side=`${Math.sign(parseFloat(x))}:${Math.sign(parseFloat(y))}`;
         if(sides.has(id) && sides.get(id)!==side)sideChanges.add(id);
         sides.set(id,side);
       }
       const shown=el.dataset.visible==='true',wasShown=visibility.get(id);
       if(wasShown===true && !shown)exits.set(id,now);
       if(wasShown===false && shown && exits.has(id) && now-exits.get(id)!<1100)earlyReturns.add(id);
       visibility.set(id,shown);
     });
     if(now-start>=14000)resolve({sideChanges:[...sideChanges],earlyReturns:[...earlyReturns],samples});
     else setTimeout(sample,100);
   };
   sample();
 }));
 expect(stability.samples).toBeGreaterThan(10);
 expect(stability.sideChanges).toEqual([]);
 expect(stability.earlyReturns).toEqual([]);
 // Software-rendered CI can advance fewer animation frames in the same wall time.
 // Reduced motion starts already fitted; enabling motion completes the gentle dolly.
 await expect.poll(averageScale,{timeout:30000}).toBeGreaterThan(before*1.05);
 const positions=()=>projectedGraphPositions(page);
 const orbiting=await positions();
 await expect.poll(async()=>{const next=await positions();return next.some((v,i)=>Math.abs(v-orbiting[i])>1);},{timeout:30000}).toBe(true);
 await page.screenshot({path:`output/cinematic-graph-${test.info().project.name}.png`});
 const bounds=(await canvas.boundingBox())!;
 if(isMobile) await page.touchscreen.tap(bounds.x+10,bounds.y+10);
 else await page.mouse.click(bounds.x+10,bounds.y+10);
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const stopped=await positions();
 await page.waitForTimeout(600);
 expect(await positions()).toEqual(stopped);
 await canvas.evaluate(el=>el.setAttribute('data-test-renderer','original'));
 // Repeating reset catches reuse of an already-completed intro timer.
 for (let replay=0;replay<2;replay++) {
   const closeScale=await averageScale();
   await page.getByRole('button',{name:'Reset view',exact:true}).click();
   await expect(canvas).toHaveAttribute('data-test-renderer','original');
   await expect.poll(averageScale).toBeLessThan(closeScale*.85);
   const wideScale=await averageScale();
   await page.waitForTimeout(14000);
   await expect.poll(averageScale,{timeout:30000}).toBeGreaterThan(wideScale*1.15);
   const moving=await positions();
   await expect.poll(async()=>{const next=await positions();return next.some((v,i)=>Math.abs(v-moving[i])>1);},{timeout:15000}).toBe(true);
 }
});
test('graph resumes gently from the user view after release and respects reduced motion', async ({page, isMobile}) => {
 test.setTimeout(60000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph');
 const canvas=page.locator('canvas');
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:20000});
 await expect(page.locator('[data-company-id]')).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
 const positions=()=>projectedGraphPositions(page);
 const still=await positions();
 expect(still.length).toBeGreaterThan(0);
 await page.waitForTimeout(500);
 expect(await positions()).toEqual(still);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await expect.poll(async()=>{const next=await positions();return next.some((v,i)=>Math.abs(v-still[i])>1);}).toBe(true);
 const bounds=(await canvas.boundingBox())!;
 // A held drag must remain stopped even beyond the idle delay.
 await page.mouse.move(bounds.x+10,bounds.y+10);
 await page.mouse.down();
 await page.mouse.move(bounds.x+60,bounds.y+35,{steps:8});
 await expect(canvas).toHaveAttribute('data-rotation','paused');
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const held=await positions();
 await page.waitForTimeout(2300);
 expect(await positions()).toEqual(held);
 await expect(canvas).toHaveAttribute('data-rotation','paused');
 await page.mouse.up();
 await expect(canvas).toHaveAttribute('data-rotation','waiting');
 const released=await positions();
 const distance=Number(await canvas.getAttribute('data-camera-distance'));
 const target=await canvas.getAttribute('data-camera-target');
 await page.waitForTimeout(600);
 expect(await positions()).toEqual(released);
 await expect(canvas).toHaveAttribute('data-rotation','resumed',{timeout:5000});
 await expect.poll(async()=>{const next=await positions();return next.some((v,i)=>Math.abs(v-released[i])>1);},{timeout:10000}).toBe(true);
 expect(Number(await canvas.getAttribute('data-camera-distance'))).toBeCloseTo(distance,5);
 expect(await canvas.getAttribute('data-camera-target')).toBe(target);
 // Resume must preserve a deliberate zoom and a new pan target as well.
 await page.mouse.move(bounds.x+10,bounds.y+10);
 await zoomWheel(page,-120);
 await page.mouse.down({button:'right'});
 await page.mouse.move(bounds.x+45,bounds.y+30,{steps:6});
 // Keep the pointer held while damping settles; release starts the idle deadline.
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const zoomed=Number(await canvas.getAttribute('data-camera-distance'));
 const panned=await canvas.getAttribute('data-camera-target');
 expect(zoomed).toBeLessThan(distance);
 expect(panned).not.toBe(target);
 await page.mouse.up({button:'right'});
 await expect(canvas).toHaveAttribute('data-rotation','resumed',{timeout:5000});
 await page.waitForTimeout(600);
 expect(Number(await canvas.getAttribute('data-camera-distance'))).toBeCloseTo(zoomed,5);
 expect(await canvas.getAttribute('data-camera-target')).toBe(panned);
 // Real touch and mouse input both stop a resumed orbit and can restart it again.
 if(isMobile) await page.touchscreen.tap(bounds.x+10,bounds.y+10);
 else await page.mouse.click(bounds.x+10,bounds.y+10);
 await expect(canvas).toHaveAttribute('data-rotation','waiting');
 await expect(canvas).toHaveAttribute('data-rotation','resumed',{timeout:5000});
 await page.emulateMedia({reducedMotion:'reduce'});
 if(isMobile) await page.touchscreen.tap(bounds.x+10,bounds.y+10);
 else await page.mouse.click(bounds.x+10,bounds.y+10);
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const reduced=await positions();
 await page.waitForTimeout(2300);
 await expect(canvas).toHaveAttribute('data-rotation','reduced');
 expect(await positions()).toEqual(reduced);
 await page.getByRole('button',{name:'Reset view',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const resetStill=await positions();
 await page.waitForTimeout(600);
 expect(await positions()).toEqual(resetStill);
});

test('filtering from external graph search stops the intro and reframes results', async ({page}) => {
 // Keep two spatial reference points: a lone centered node cannot reveal an orbit.
 const fixture={...graph,nodes:graph.nodes.map(n=>n.id==='US:AMD'?{...n,name:'NVDA supplier AMD'}:n)};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph');
 const canvas=page.locator('canvas');
 await expect(page.locator('[data-company-id]')).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('NVDA');
 const label=page.locator('[data-company-id="US:NVDA"]');
 await expect(page.locator('[data-company-id]')).toHaveCount(2);
 await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
 const stopped=await projectedGraphPositions(page);
 await page.waitForTimeout(600);
 expect(await projectedGraphPositions(page)).toEqual(stopped);
 await expect(label).toBeVisible();
});

test('compact map controls keep list filters out of the graph', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph&listingMarket=CN_A&following=1');
 await expect(page.locator('canvas')).toBeVisible();
 await expect(page.getByText('EXPLORE',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveText('List');
 await expect(page.getByRole('tab',{name:'Industry structure',exact:true})).toHaveText('Structure');
 await expect(page.getByLabel('Listing market',{exact:true})).toBeHidden();
 await expect(page.locator('[data-company-id]')).toHaveCount(graph.nodes.filter(n=>n.kind==='COMPANY').length,{timeout:20000});
 await page.getByLabel('About the AI Industry Map').click();
 await expect(page.getByText('Explore AI stocks, companies, and supply-chain relationships.',{exact:true})).toBeVisible();
 await page.getByLabel('About the AI Industry Map').click();
 await expect(page.getByRole('group',{name:'Colors by primary AI sector'})).toBeHidden();
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('no such company');
 await expect(page.getByRole('region',{name:'Search results'}).getByText('No matching companies.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page.locator('[data-company-id]')).toHaveCount(graph.nodes.filter(n=>n.kind==='COMPANY').length);
 await page.screenshot({path:`output/compact-map-${test.info().project.name}.png`,fullPage:true});
});
test('company table paginates globally sorted results and restores browsing state', async ({page}) => {
 const fixture:KnowledgeGraph={...graph,relationships:[],nodes:Array.from({length:61},(_,i)=>({
   id:`US:PAGE${i+1}`,kind:'COMPANY',name:`Company ${String(i+1).padStart(3,'0')}`,symbol:`PAGE${i+1}`,market:'US',order:i,stageIds:['compute'],
   ...(i===60?{}:{marketCap:{value:(i+1)*1e9,currency:'USD' as const,priceDate:'2026-09-25'}})
 }))};
 await page.route('**/*',r=>new URL(r.request().url()).pathname==='/api/knowledge-graph'?r.fulfill({json:fixture}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=table');
 const rows=page.locator('[data-list-company]');
 const pagination=page.getByRole('navigation',{name:'Company list pagination'});
 await expect(rows).toHaveCount(50);
 await expect(pagination).toContainText('Showing 1–50 of 61 companies');
 await expect(pagination.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
 await pagination.getByRole('button',{name:'Next',exact:true}).click();
 await expect(rows).toHaveCount(11);
 await expect(rows.first()).toHaveAttribute('data-list-company','US:PAGE51');
 await expect(pagination.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await rows.first().getByRole('button').click();
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 await expect(pagination).toContainText('Page 2 / 2');
 await page.getByLabel('Rows per page').selectOption('25');
 await expect(rows).toHaveCount(25);
 await expect(pagination).toContainText('Page 1 / 3');
 await page.getByRole('button',{name:'Market value',exact:true}).click();
 await expect(rows.first()).toHaveAttribute('data-list-company','US:PAGE60');
 await pagination.getByRole('button',{name:'Next',exact:true}).click();
 await revealListFilters(page);
 await page.getByLabel('Listing market',{exact:true}).selectOption('US');
 await expect(pagination).toContainText('Page 1 / 3');
 await pagination.getByRole('button',{name:'Next',exact:true}).click();
 await page.goto('http://graph.test/profile?lang=en');
 await page.goBack();
 await expect(pagination).toContainText('Page 2 / 3');
 await revealListFilters(page);
 await expect(page.getByLabel('Listing market',{exact:true})).toHaveValue('US');
 await expect(rows.first()).toHaveAttribute('data-list-company','US:PAGE35');
 await pagination.getByRole('button',{name:'Next',exact:true}).click();
 await expect(rows.last()).toHaveAttribute('data-list-company','US:PAGE61');
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('Company 001');
 await expect(rows).toHaveCount(1);
 await expect(pagination).toContainText('Page 1 / 1');
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('no such company');
 await expect(page.getByText('No matching companies.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByLabel('Rows per page').selectOption('100');
 await expect(rows).toHaveCount(61);
 await page.goto('http://graph.test/map?lang=en&view=table&page=-1&pageSize=oops');
 await expect(rows).toHaveCount(50);
 await expect(pagination).toContainText('Page 1 / 2');
 await page.screenshot({path:`output/table-pagination-${test.info().project.name}.png`,fullPage:true});
});
test('private valuations display currency, qualifier, date and source in list and details', async ({page}) => {
 const fixture:KnowledgeGraph={...graph,nodes:[...graph.nodes.filter(n=>n.kind==='STAGE'),
   {id:'ORG:MISTRAL-AI',kind:'COMPANY',name:'Mistral AI',market:'GLOBAL',listingStatus:'PRIVATE',order:0,stageIds:['compute'],privateValuation:{value:21e9,currency:'EUR',qualifier:'greater_than',valuationDate:'2026-09-08',basis:'post_money',sourceUrl:'https://mistral.ai/news/mistral-makes-sovereign-open-weight-ai-to-frontier/',reviewedAt:'2026-09-25',verification:'source_checked',reviewPending:false}},
   {id:'ORG:OPENAI',kind:'COMPANY',name:'OpenAI',market:'GLOBAL',listingStatus:'PRIVATE',order:1,stageIds:['compute'],privateValuation:{value:852e9,currency:'USD',qualifier:'exact',valuationDate:'2026-03-31',basis:'post_money',sourceUrl:'https://openai.com/index/accelerating-the-next-phase-ai/',reviewedAt:'2026-09-25',verification:'reviewed',reviewPending:true}}],relationships:[]};
 await page.route('**/*',r=>new URL(r.request().url()).pathname==='/api/knowledge-graph'?r.fulfill({json:fixture}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en');
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 const mistral=page.locator('[data-list-company="ORG:MISTRAL-AI"]');
 await expect(mistral).toContainText('> €21B');
 await expect(mistral.getByRole('link')).toHaveAttribute('title', /Private valuation · post-money/);
 await expect(mistral).toContainText('2026-09-08');
 await expect(mistral.getByRole('link')).toHaveAttribute('href',fixture.nodes.find(n=>n.id==='ORG:MISTRAL-AI')!.privateValuation!.sourceUrl);
 const openai=page.locator('[data-list-company="ORG:OPENAI"]');
 await expect(openai.getByRole('link')).toHaveText('$852B');
 await expect(openai.getByRole('link')).toHaveAttribute('title', /Automated recheck unavailable/);
 await openai.getByRole('button').click();
 await expect(page.getByRole('complementary',{name:'Company details'}).locator('[data-private-valuation]')).toContainText('$852B');
});
// A plain wheel scrolls the page over 3D canvases; Ctrl + wheel (and trackpad pinch) zooms them.
async function zoomWheel(page: Page, deltaY: number) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
}
test("map flags use company country and omit unknown countries", async ({page}) => {
  const countries = structuredClone(graph);
  countries.nodes.find(n => n.id === "US:NVDA")!.country = "US";
  countries.nodes.find(n => n.id === "US:TSM")!.country = "TW";
  delete countries.nodes.find(n => n.id === "US:AAPL")!.country;
  await page.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/knowledge-graph") return route.fulfill({json:countries});
    if (/^\/flags\/[a-z]{2}\.svg$/.test(path)) return route.fulfill({contentType:"image/svg+xml",body:readFileSync(process.cwd() + "/public" + path)});
    return route.fulfill({contentType:"text/html",body:html});
  });
  await page.goto("http://graph.test/map?lang=en");
  const tsm = page.locator('[data-company-id="US:TSM"]');
  await expect(tsm.locator("img")).toHaveAttribute("src", "/flags/tw.svg");
  await expect(tsm).toHaveAttribute("aria-label", /Taiwan/);
  await expect(page.locator('[data-company-id="US:NVDA"] img')).toHaveAttribute("src", "/flags/us.svg");
  await expect(page.locator('[data-company-id="US:AAPL"] img')).toHaveCount(0);
  await expect.poll(() => tsm.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});
test("every sector dims unrelated names and restores the full map on toggle", async ({page}) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*", r => r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const layout = layout3D(graph);
  // Match the other full-graph readiness check: each HTML label mounts in a separate React root.
  await expect(page.locator("[data-company-id]")).toHaveCount(layout.nodes.length,{timeout:20_000});
  const revealSectors = async () => {
    const toggle = page.getByRole("button", {name:/^Sectors/});
    if (await toggle.isVisible()) await toggle.click();
  };
  for (const sector of GRAPH_SECTORS) {
    const members = new Set(layout.nodes.filter(n => companySector(n).id === sector.id).map(n => n.id));
    if (!members.size) continue;
    const related = new Set(layout.edges.filter(e => members.has(e.source) || members.has(e.target)).flatMap(e => [e.source,e.target]));
    await revealSectors();
    const button = page.getByRole("button", {name:sector.en,exact:true,includeHidden:true});
    await button.click();
    await page.mouse.move(0,0);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-sector-emphasis="member"]')).toHaveCount(members.size);
    const opacities = await page.locator("[data-company-id]").evaluateAll(elements => elements.map(el => ({id:el.getAttribute("data-company-id")!, visible:(el as HTMLElement).dataset.visible==="true", emphasis:Number(getComputedStyle(el).getPropertyValue("--label-emphasis")||1), opacity:Number(getComputedStyle(el).opacity)})));
    for (const node of opacities) {
      const emphasis=members.has(node.id)?1:related.has(node.id)?.85:.18;
      expect(node.emphasis,`${sector.en}: ${node.id}`).toBe(emphasis);
      expect(node.opacity,`${sector.en}: ${node.id}`).toBe(node.visible?emphasis:0);
    }
    await expect(page.locator("[data-company-id]")).toHaveCount(layout.nodes.length);
    await revealSectors();
    await button.click();
    await page.mouse.move(0,0);
    await expect(page.locator("[data-sector-emphasis]")).toHaveCount(0);
    expect(await page.locator("[data-company-id]").evaluateAll(elements => elements.every(el => Number(getComputedStyle(el).getPropertyValue("--label-emphasis")||1)===1 && Number(getComputedStyle(el).opacity)===((el as HTMLElement).dataset.visible==="true"?1:0)))).toBe(true);
  }
});
for(const sectorFocused of [false,true]) test(`line hover previews, click pins, and blank space clears (${sectorFocused?"sector":"overview"})`,async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const canvas=page.locator("canvas"), labels=page.locator('[data-source]:visible');
  await expect(canvas).toBeVisible();
  await expect(page.locator('[data-company-id]')).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
  await expect(page.locator('[data-company-id]:visible').first()).toBeVisible();
  await expect(labels).toHaveCount(0);
  if(sectorFocused){
    const toggle=page.getByRole("button",{name:/^Sectors/});
    if(await toggle.isVisible())await toggle.click();
    await page.getByRole("button",{name:"AI compute",exact:true}).click();
    await expect.poll(()=>page.locator('[data-sector-emphasis="member"]').count()).toBeGreaterThan(0);
  }
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
  const box=(await canvas.boundingBox())!;
  const layout=layout3D(graph);
  const members=layout.nodes.filter(n=>companySector(n).id==="compute");
  const center=sectorFocused?members.reduce((v,n)=>v.add(new Vector3(n.x,n.y,n.z)),new Vector3()).divideScalar(members.length):new Vector3();
  const radius=sectorFocused?Math.max(80,...members.map(n=>new Vector3(n.x,n.y,n.z).distanceTo(center))):layout.radius;
  const distance=radius/Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,box.width/box.height)))*(sectorFocused?1.1:1.15);
  const camera=new PerspectiveCamera(45,box.width/box.height,1,10000);
  camera.position.set(center.x+distance*.2,center.y+distance*.12,center.z+distance);camera.lookAt(center);camera.updateMatrixWorld();
  let hit:{x:number;y:number}|undefined;
  for(const edge of layout.edges){
    const a=layout.nodes.find(n=>n.id===edge.source)!,b=layout.nodes.find(n=>n.id===edge.target)!;
    const p=new Vector3(a.x,a.y,a.z).lerp(new Vector3(b.x,b.y,b.z),.55).project(camera);
    const x=box.x+(p.x+1)*box.width/2,y=box.y+(1-p.y)*box.height/2;
    await page.mouse.move(5,5);await expect(labels).toHaveCount(0);
    await page.mouse.move(x,y);await page.waitForTimeout(100);
    if(await labels.count()){hit={x,y};break;}
  }
  expect(hit).toBeDefined();
  await expect(labels).toHaveCount(1);
  await page.mouse.click(hit!.x,hit!.y);
  await expect(page.locator("[data-sector-emphasis]")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Selected connection",exact:true})).toBeVisible();
  await page.mouse.move(5,5);
  await expect(page.locator('[data-active="true"]:visible')).toHaveCount(1);
  await canvas.scrollIntoViewIfNeeded();const current=(await canvas.boundingBox())!;
  await page.mouse.click(current.x+5,current.y+5);
  await expect(labels).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Selected connection",exact:true})).toHaveCount(0);
});
let html: string;
test("event deep link opens source evidence beside the selected company", async ({page}) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&company=US%3AAMD&event=amd-cisco-humain-live-20260831");
  const evidence=page.getByRole("region",{name:"Selected event evidence"});
  await expect(evidence.getByRole("heading",{name:"AMD and Cisco report HUMAIN systems are live"})).toBeVisible();
  await expect(evidence.getByRole("link")).toHaveAttribute("href",/ir.amd.com\/news-events\/press-releases\/detail\/1298/);
  await expect(evidence).toContainText("2026-08-31");
  await page.getByRole("button",{name:"Clear selection"}).click();
  await expect(evidence).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("event")).toBe(false);
});
test("admin edits a company name in place and stale edits show a conflict", async ({page}) => {
 const localized = structuredClone(graph);
 const tsm = localized.nodes.find(n => n.id === "US:TSM")!;
 tsm.names = {en:"TSMC", "zh-CN":"台积公司"};
 let edits = 0;
 await page.route("**/*", async route => {
   const url = new URL(route.request().url());
   if (url.pathname === "/api/knowledge-graph") return route.fulfill({json:localized});
   if (url.pathname === "/api/admin/me") return route.fulfill({json:{isAdmin:true}});
   if (url.pathname === "/api/map-follows") return route.fulfill({json:{followedCompanyIds:[]}});
   if (url.pathname === "/api/admin/company-names") {
     expect(route.request().method()).toBe("PATCH");
     expect(route.request().headers().authorization).toBe("Bearer fixture");
     edits++;
     if (edits > 1) return route.fulfill({status:409,json:{error:"Conflict"}});
     expect(route.request().postDataJSON()).toEqual({companyId:"US:TSM",locale:"zh-CN",name:"台积电",expectedName:"台积公司"});
     return route.fulfill({json:{companyId:"US:TSM",names:{en:"TSMC","zh-CN":"台积电"},aliases:["台积公司"]}});
   }
   return route.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://graph.test/map?account&lang=zh-CN");
 await revealMapSearch(page);
 await page.getByRole("textbox",{name:"搜索公司",exact:true}).fill("TSM");
 await page.getByRole("region",{name:"搜索结果"}).getByRole("button",{name:"台积公司 · TSM",exact:true}).click();
 await page.getByRole("button",{name:"修改显示名",exact:true}).click();
 await page.getByRole("textbox",{name:"中文显示名",exact:true}).fill("台积电");
 await page.getByRole("button",{name:"保存",exact:true}).click();
 await expect(page.getByRole("heading",{name:"台积电",exact:true})).toBeVisible();
 await expect(page.getByText("显示名已保存。",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"修改显示名",exact:true}).click();
 await page.getByRole("textbox",{name:"中文显示名",exact:true}).fill("台積電");
 await page.getByRole("button",{name:"保存",exact:true}).click();
 await expect(page.getByText("名称已被修改，请刷新页面后再编辑。",{exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"台积电",exact:true})).toBeVisible();
});
test.beforeEach(async ({page}, info) => {
  if (!info.title.startsWith('three views')) await page.addInitScript(() => localStorage.setItem('ya-industry-view','graph'));
});

test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {AiKnowledgeGraph} from "./src/components/ai-knowledge-graph";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"zh-CN"}><AiKnowledgeGraph initialCompany={new URLSearchParams(location.search).get("company") ?? ""} initialEvent={new URLSearchParams(location.search).get("event") ?? ""} initialEdge={new URLSearchParams(location.search).get("relationship") ?? ""}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "graph.js", platform: "browser", define: {"process.env":"{}"}, plugins: [{ name: "map-account-fixture", setup(build) { build.onLoad({ filter: /auth-provider\.tsx$/ }, () => ({ loader: "tsx", contents: `const getIdToken = async () => "fixture"; const account = {user:{uid:"map-user"},getIdToken}; export function useOptionalAuth(){return new URLSearchParams(location.search).has("account") ? account : undefined;} export function useAuth(){return {...(useOptionalAuth() ?? {user:null,getIdToken}),loading:false};}` })); } }] });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#08131d;font-family:Arial}*{box-sizing:border-box}button,input{font:inherit} ${bundle.outputFiles.find(f => f.path.endsWith(".css"))?.text}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test("combination retains every company and isolates evidence IDs", () => {
  expect(graph.nodes.filter(n => n.kind === "COMPANY")).toHaveLength(129);
  expect(new Set(graph.sources.map(s => s.id)).size).toBe(graph.sources.length);
  const sourceIds = new Set(graph.sources.map(s => s.id));
  expect(graph.relationships.every(e => e.sourceIds.every(id => sourceIds.has(id)))).toBe(true);
  for (const markets of [["US"], ["CN_A"], ["US", "CN_A"]] as const) {
    const visible = filterGraph(graph, [...markets]);
    const positions = layoutGraph(visible.nodes).positions;
    expect(visible.nodes.every(n => positions.has(n.id))).toBe(true);
    expect(visible.relationships.every(e => positions.has(e.source) && positions.has(e.target))).toBe(true);
  }
});

for (const language of ["en", "zh-CN"]) test(`directory renders only on expansion and reuses graph data (${language})`, async ({ page }) => {
  let requests = 0;
  await page.route("**/*", route => {
    if (route.request().url().includes("/api/knowledge-graph")) {
      requests++;
      return route.fulfill({ json: graph });
    }
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto(`http://graph.test/map?lang=${language}`);
  await expect(page.locator('span[role="status"]')).toContainText("129");
  const directory = page.getByRole("region", { name: language === "en" ? "AI companies and supply chain" : "AI 公司与产业链", exact: true });
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.getByRole("heading", { name: language === "en" ? "Documented company relationships" : "已收录公司关系", exact: true })).toBeVisible();
  expect(await directory.getByRole("link").count()).toBeGreaterThan(129);
  await directory.locator("summary").click();
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.locator("li").first()).toBeVisible();
  expect(requests).toBe(1);
});
test("star layout retains isolated companies and only draws recorded company edges", () => {
  const layout = layoutCompanies(graph);
  expect(layout.nodes).toHaveLength(129);
  expect(layout.edges).toEqual(graph.relationships.filter(e => e.type !== "PARTICIPATES_IN"));
  expect(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 0 && n.x <= layout.width && n.y >= 0 && n.y <= layout.height)).toBe(true);
  expect(layoutCompanies(graph)).toEqual(layout);
});
test("graph renders, orbits and resets without extra controls", async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("button", { name: /^(2D|3D|Fit|Zoom in|Zoom out|Rotate left|Rotate right)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", {name:"Filing explorer",exact:true})).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator('[data-company-id]')).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});

  await expect(page.getByRole("button", { name: "NVIDIA · NVDA", exact:true })).toBeVisible();
  await page.screenshot({fullPage:true,path:`output/graph-3d-${test.info().project.name}.png`});
  const canvas=page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const before=await projectedGraphPositions(page);
  const bounds=(await canvas.boundingBox())!;
  // Start on the canvas itself: a company label can intercept a fixed drag coordinate.
  const start=await canvas.evaluate(el=>{
    const b=el.getBoundingClientRect();
    for(const y of [.1,.5,.9])for(const x of [.05,.25,.75,.95]){
      const p={x:b.x+b.width*x,y:b.y+b.height*y};
      if(document.elementFromPoint(p.x,p.y)===el)return p;
    }
    throw new Error('No unobstructed canvas drag point');
  });
  const direction=start.x<bounds.x+bounds.width/2?1:-1;
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(start.x+direction*Math.min(120,bounds.width*.3),start.y,{steps:12});
  await page.mouse.up();
  await expect.poll(async()=>{
    const after=await projectedGraphPositions(page);
    return Math.max(...after.map((v,i)=>Math.abs(v-before[i])));
  }).toBeGreaterThan(2);
 await revealMapSearch(page);
  await page.getByRole("textbox", {name:"Search companies"}).fill("688041");
  await page.getByRole("region", {name:"Search results"}).getByRole("button", {name:"海光信息 · 688041",exact:true}).click();
  await expect(page.getByRole("heading", { name: "海光信息",exact:true })).toBeVisible();
  await page.getByRole("button", { name:"Reset view",exact:true }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator("[data-company-id]")).toHaveCount(layout3D(graph).nodes.length,{timeout:20000});
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  expect(new URL(page.url()).searchParams.has("company")).toBe(false);
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});


test("devices without WebGL keep the directory collapsed until requested", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("alert")).toContainText("This browser cannot display the 3D graph");
  const directory = page.getByRole("region", {name:"AI companies and supply chain",exact:true});
  await expect(directory.locator("details").first()).not.toHaveAttribute("open", "");
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.locator("li").first()).toBeVisible();
  await expect(page.getByRole("button", {name:/2D|3D/})).toHaveCount(0);
});

test("global search and company research links work in Chinese", async ({page}) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({json:graph}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=zh-CN");
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await expect(page.getByRole("button", { name: /^(美股|A 股|全球及非上市)$/ })).toHaveCount(0);
  await revealMapSearch(page);
  await page.getByRole("textbox",{name:"搜索公司"}).fill("NVDA");
  await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("heading",{name:"NVIDIA",exact:true})).toBeVisible();
  await page.getByText("研究来源", { exact: true }).click();
  await expect(page.getByRole("link",{name:"财报关系探索 →",exact:true})).toHaveCount(0);
  expect(await page.getByRole("complementary").locator('a[href^="https://"]').count()).toBeGreaterThan(0);
  await page.getByRole("button",{name:"重置视图",exact:true}).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("failed graph loads can retry", async ({page}) => {
  let fail=true;
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill(fail?{status:503,json:{error:"unavailable"}}:{json:graph}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  fail=false;
  await page.getByRole("button",{name:"Try again"}).click();
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await expect(page.locator("canvas")).toBeVisible();
});

test("global company details remain available with legacy market filters", async ({ page }) => {
  const globalGraph: KnowledgeGraph = { ...graph, nodes: [...graph.nodes, { id: "ORG:LAB", kind: "COMPANY", name: "Independent Lab", symbol: "", market: "GLOBAL", country: "FR", listingStatus: "PRIVATE", listings: [], stageIds: ["cloud"], order: 150, sourceIds: [] }] };
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: globalGraph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en&graphMarkets=GLOBAL");
  await expect(page.locator('span[role="status"]')).toContainText("130 companies");
 await revealMapSearch(page);
  await page.getByRole("textbox", { name: "Search companies" }).fill("Independent Lab");
  await page.getByRole("region", {name:"Search results"}).getByRole("button", { name: /Independent Lab/ }).click();
  await expect(page.getByRole("complementary")).toContainText("France · Private");
  await expect(page.getByRole("link", { name: "Company profile →" })).toHaveAttribute("href", "/company/ORG%3ALAB");
  await page.reload();
  await expect(page.getByRole("textbox", {name:"Search companies"})).toHaveValue("Independent Lab");
  await expect(page.locator('span[role="status"]')).toContainText("1 companies");
  await expect(page.getByRole("complementary")).toContainText("France · Private");
  await page.getByRole("button", {name:"Clear filters",exact:true}).click();
  await expect(page.locator('span[role="status"]')).toContainText("130 companies");
  await expect(page.getByRole("button", { name: /^(US stocks|A-shares|Global & private)$/ })).toHaveCount(0);
});

for (const language of ["en", "zh-CN"]) test(`sector legend replaces discovery controls (${language})`, async ({page}) => {
 let followRequests = 0;
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*", r => {
  if(r.request().url().includes("/api/map-follows")){ followRequests++; return r.fulfill({json:{companyIds:[]}}); }
  return r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto(`http://graph.test/map?lang=${language}&account=1`);
 await expect(page.locator("canvas")).toBeVisible();
 await expect(page.getByText(/Guided journeys|探索路线|What’s new|Following ·/)).toHaveCount(0);
 const toggle=page.getByRole("button",{name:language==="en"?/^Sectors/:/^产业环节/});
 const compact=(page.viewportSize()?.width??1280)<=800;
 if(compact){
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(page.getByText(language==="en"?"Tap a line for relationship evidence":"点按连线查看关系依据",{exact:true})).toBeVisible();
 }else{
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(page.getByText(language==="en"?"Hover a line to preview · Click for evidence":"悬停连线预览关系 · 点击查看依据",{exact:true})).toBeVisible();
 }
 async function revealSectors(){await toggle.click();}
 const sector = page.getByRole("button",{name:language === "en" ? "AI compute" : "AI 算力",exact:true,includeHidden:true});
 await revealSectors();
 await sector.click();
 await expect(sector).toHaveAttribute("aria-pressed","true");
 await expect.poll(()=>page.locator('[data-sector-emphasis="member"]').count()).toBeGreaterThan(0);
 await revealSectors();
 await sector.click();
 await expect(sector).toHaveAttribute("aria-pressed","false");
 await expect(page.locator('[data-sector-emphasis]')).toHaveCount(0);
 await revealSectors();
 await sector.click();
 await page.getByRole("button",{name:language === "en" ? "Reset view" : "重置视图",exact:true}).click();
 await expect(sector).toHaveAttribute("aria-pressed","false");
 expect(followRequests).toBe(1);
});

test("opening relationship evidence preserves the current company",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await revealMapSearch(page);
 await page.getByRole("textbox",{name:"Search companies"}).fill("NVDA");
 await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Clear filters",exact:true}).click();
 const canvas=page.locator("canvas");
 await canvas.scrollIntoViewIfNeeded();
 const bounds=(await canvas.boundingBox())!;
 const anchor=page.locator('[data-company-id="US:TSM"]');
 const projection=()=>anchor.evaluate(el=>el.parentElement!.parentElement!.style.transform);
 const initial=await projection();
 const start=await canvas.evaluate(el=>{
   const b=el.getBoundingClientRect();
   for(const y of [.1,.5,.9])for(const x of [.05,.25,.75,.95]){
     const p={x:b.x+b.width*x,y:b.y+b.height*y};
     if(document.elementFromPoint(p.x,p.y)===el)return p;
   }
   throw new Error('No unobstructed canvas drag point');
 });
 const direction=start.x<bounds.x+bounds.width/2?1:-1;
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(start.x+direction*Math.min(120,bounds.width*.3),start.y,{steps:12});
 await page.mouse.up();
 await expect.poll(projection).not.toBe(initial);
 await page.waitForTimeout(800);
 const orbited=await projection();
 expect(orbited).toContain("translate");
 await page.getByRole("button",{name:"TSMC → NVIDIA",exact:true}).click();
 await expect.poll(projection).toBe(orbited);
 await expect(page.getByRole("complementary").getByRole("heading",{level:2})).toHaveText("NVIDIA");
 await page.getByRole("region",{name:"Selected connection"}).getByRole("button",{name:"Explore TSMC →"}).click();
 await expect(page.getByRole("complementary").getByRole("heading",{level:2})).toHaveText("TSMC");
});

for (const language of ["en", "zh-CN"]) test(`company browser focuses graph and retains global search (${language})`, async ({page})=>{
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto(`http://graph.test/map?lang=${language}`);
  await expect(page.locator("canvas")).toBeVisible();
 await revealMapSearch(page);
  const search=page.getByRole("textbox",{name:language==="en"?"Search companies":"搜索公司",exact:true});
  await search.fill("NVDA");
  await expect(page.locator('span[role="status"]')).toHaveText(language==="en"?"1 companies · 0 documented connections":"1 家公司 · 0 项已收录关系");
  await page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("complementary")).toContainText("NVIDIA");
  await expect(search).toHaveValue("NVDA");
  await page.locator("summary").filter({hasText:language==="en"?"Browse companies":"浏览公司"}).click();
  await page.getByRole("textbox",{name:language==="en"?"Find a company in the list":"在列表中查找公司"}).fill("NVDA");
  const browser=page.locator("details").filter({has:page.getByRole("textbox",{name:language==="en"?"Find a company in the list":"在列表中查找公司"})});
  await expect(browser.getByRole("button")).toHaveCount(1);
  await browser.getByRole("button").click();
  await expect(page).toHaveURL(/company=US%3ANVDA/);
});

test("selected relationships stay readable and evidence remains actionable", async ({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(()=>page.locator('button[class*="label3d"]:visible').count()).toBeGreaterThan(2);
  await page.screenshot({path:`output/map-readable-${testInfo.project.name}.png`});
 await revealMapSearch(page);
  await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
  await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.emulateMedia({reducedMotion:"no-preference"});
  const canvas=page.locator('canvas');
  const bounds=(await canvas.boundingBox())!;
  await page.mouse.click(bounds.x+10,bounds.y+10);
  await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:10000});
  const focused=await projectedGraphPositions(page);
  await page.waitForTimeout(2300);
  await expect(canvas).toHaveAttribute('data-rotation','focused');
  // Drei may finish a sub-pixel label update after the camera settles.
  expect(Math.max(...(await projectedGraphPositions(page)).map((v,i)=>Math.abs(v-focused[i])))).toBeLessThan(.1);
  await page.mouse.move(5,5);
  const labels=page.locator('button[class*="edgeLabel3d"]:visible');
  await expect(labels).toHaveCount(0);
  await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
  await expect(labels).toHaveCount(1);
  await labels.first().click();
  await expect(page.getByRole("region",{name:"Selected connection"})).toBeVisible();
  const connection=await projectedGraphPositions(page);
  await page.waitForTimeout(2300);
  await expect(canvas).toHaveAttribute('data-rotation','focused');
  expect(Math.max(...(await projectedGraphPositions(page)).map((v,i)=>Math.abs(v-connection[i])))).toBeLessThan(.1);
});


test("unselected zoom never shows context-free relationship labels", async ({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const canvas=page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(()=>page.locator('[data-company-id]:visible').count()).toBeGreaterThan(0);
  await canvas.hover({position:{x:20,y:100}});
  await zoomWheel(page,-1200);
  await expect.poll(()=>page.locator('[data-source]').evaluateAll(els=>{
    const nodes=[...document.querySelectorAll('[data-company-id]')].filter(el=>el.checkVisibility({visibilityProperty:true})).map(el=>el.getAttribute('data-company-id'));
    return els.filter(el=>el.checkVisibility({visibilityProperty:true})).filter(el=>!nodes.includes(el.getAttribute('data-source'))&&!nodes.includes(el.getAttribute('data-target'))).length;
  })).toBe(0);
});


test("company layout retains real depth",()=>{
  const layout=layout3D(graph);
  expect(layout.nodes).toHaveLength(129);
  for(const axis of ["x","y","z"] as const){
    const positions=layout.nodes.map(n=>n[axis]);
    expect(Math.max(...positions)-Math.min(...positions)).toBeGreaterThan(150);
  }
});

test("company text grows on zoom in and shrinks on zoom out",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const label=page.locator('button[class*="label3d"]').filter({hasText:"NVIDIA"}).locator("strong");
  await expect(label).toBeVisible();
  const fontSize=()=>label.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const initial=await fontSize();
  await page.locator("canvas").hover({position:{x:20,y:100}});
  await zoomWheel(page,-400);
  await expect.poll(fontSize).toBeGreaterThan(initial+.5);
  const enlarged=await fontSize();
  await zoomWheel(page,400);
  await expect.poll(fontSize).toBeLessThan(enlarged-.5);
});

test("unclassified companies have their own spatial anchor",()=>{
 const layout=layout3D({...graph,nodes:[...graph.nodes,{id:"ORG:RELATED",kind:"COMPANY",name:"Related company",stageIds:["related"],market:"GLOBAL",order:999}]});
 const related=layout.nodes.find(n=>n.id==="ORG:RELATED")!;
 const semiconductor=layout.nodes.find(n=>n.stageIds?.[0]==="materials")!;
 expect([related.ax,related.ay,related.az]).not.toEqual([semiconductor.ax,semiconductor.ay,semiconductor.az]);
});

test("sector names scale with zoom and focus a 3D cluster",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const sectors=page.getByRole("button",{name:/^Focus sector:/});
 await expect.poll(()=>sectors.count()).toBeGreaterThan(0);
 const firstName=await sectors.first().getAttribute("aria-label");
 const sector=page.getByRole("button",{name:firstName!,exact:true});
 const initial=await sector.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 await sector.click();
 await expect.poll(()=>page.locator(`button[aria-label="${firstName}"]`).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(initial);
 await expect(page.getByRole("button",{name:"Reset view",exact:true})).toBeVisible();
});

test("selected relationship label has priority and company details remain readable",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await revealMapSearch(page);
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
 await expect(page.getByRole("button",{name:"DELL Integrates technology from NVDA",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"NVIDIA · NVDA",exact:true})).toBeVisible();
 const largest=await page.locator('button[class*="label3d"] strong').evaluateAll(els=>Math.max(...els.map(el=>parseFloat(getComputedStyle(el).fontSize))));
 expect(largest).toBeLessThanOrEqual(18);
 const selectedDetails=page.locator('[data-company-id="US:NVDA"]');
 await expect(selectedDetails).toBeVisible();
 expect(await selectedDetails.locator("strong").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
 expect(await selectedDetails.locator("span").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
 await page.locator("canvas").scrollIntoViewIfNeeded();
 await page.screenshot({path:`output/cluster-labels-${test.info().project.name}.png`});
});

for(const language of ["en","zh-CN"]) test(`company names and cross-language search follow locale (${language})`,async({page})=>{
 const localized=structuredClone(graph);
 const nvda=localized.nodes.find(n=>n.id==="US:NVDA")!;
 nvda.names={en:"NVIDIA", "zh-CN":"英伟达"};nvda.aliases=["辉达"];
 const display=language==="en"?"NVIDIA":"英伟达";
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:localized}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto(`http://graph.test/map?lang=${language}`);
 await revealMapSearch(page);
 const search=page.getByRole("textbox",{name:language==="en"?"Search companies":"搜索公司",exact:true});
 for(const query of ["NVIDIA","英伟达","辉达"]){
  await search.fill(query);
  await expect(page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button",{name:`${display} · NVDA`,exact:true})).toBeVisible();
 }
 await page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button").click();
 await expect(page.getByRole("heading",{name:display,exact:true})).toBeVisible();
 await expect(page.locator('[data-company-id="US:NVDA"]')).toHaveText(`${display}NVDA`);
 await expect(page.locator('[data-company-id="US:NVDA"]')).toBeVisible();
});

test("relationship labels always have a visible company endpoint",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await revealMapSearch(page);
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
 await expect(page.locator('[data-active="true"]')).toBeVisible();
 const orphanLabels=()=>page.locator('[data-source]').evaluateAll(els=>{
  const visible=(el:Element)=>el.checkVisibility({visibilityProperty:true});
  const nodes=[...document.querySelectorAll('[data-company-id]')].filter(visible).map(el=>el.getAttribute('data-company-id'));
  return els.filter(visible).filter(el=>!nodes.includes(el.getAttribute('data-source'))&&!nodes.includes(el.getAttribute('data-target'))).length;
 });
 await expect.poll(orphanLabels).toBe(0);
 const canvas=page.locator("canvas");
 // Labels can now occupy this point; move the real pointer without requiring bare canvas.
 const hoverGraph=async()=>{await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+20,box!.y+100);};
 await hoverGraph();
 await zoomWheel(page,-2500);
 await expect.poll(orphanLabels).toBe(0);
 await hoverGraph();await zoomWheel(page,2500);
 await expect.poll(orphanLabels).toBe(0);
});


test("company labels keep their placement during rotation and after release",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const canvas=page.locator("canvas");
 // Every <Html> label mounts through its own React root; on a slow runner some are still
 // mounting after the first appears, and a late label would pop in mid-test with no placement.
 // Mounting all of them is steady but CPU-bound: ~1.3 s locally, while a shared CI runner
 // (other worker in a WebGL test) was seen at 0 -> 41 -> 79 of 129 after 5 s. The expect
 // default (5 s) is a speed limit, not a correctness bound, so allow 20 s; the exact count
 // is unchanged.
 await expect(page.locator("[data-company-id]")).toHaveCount(layout3D(graph).nodes.length,{timeout:20_000});
 await expect(page.locator('[data-company-id]:visible').first()).toBeVisible();
 await canvas.scrollIntoViewIfNeeded();
 const sides=()=>page.locator('[data-company-id]:visible').evaluateAll(els=>els.map(el=>({id:el.getAttribute('data-company-id'),x:Math.sign(parseFloat((el as HTMLElement).style.getPropertyValue('--label-offset-x'))),y:Math.sign(parseFloat((el as HTMLElement).style.getPropertyValue('--label-offset-y')))})));
 const box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.8);
 await page.mouse.down();
 const before=await sides();
 await page.mouse.move(box.x+box.width*.28,box.y+box.height*.82,{steps:10});
 const during=await sides();
 const retained=during.filter(n=>before.some(b=>b.id===n.id));
 expect(retained.length).toBeGreaterThan(5);
 for(const node of retained)expect(node).toEqual(before.find(b=>b.id===node.id));
 // Let camera damping finish while held, then isolate the release from projection changes.
 // Damping can outlast any fixed wait on a slow runner, so wait for camera-controls to sleep.
 // The two frames guarantee the drag's first camera update (wake) has run before checking.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(canvas).toHaveAttribute("data-camera","idle",{timeout:10000});
 const held=await sides();
 expect(held.some(node=>!before.some(old=>old.id===node.id))).toBe(true);
 expect(before.some(node=>!held.some(current=>current.id===node.id))).toBe(true);
 for(const node of held.filter(node=>before.some(old=>old.id===node.id)))expect(node).toEqual(before.find(old=>old.id===node.id));
 await page.mouse.up();
 await page.waitForTimeout(1000);
 await expect(canvas).toHaveAttribute("data-camera","idle");
 expect(await sides()).toEqual(held);
 const hiddenPoints=await page.locator('[data-company-id]').evaluateAll(els=>els.filter(el=>getComputedStyle(el).visibility==='hidden').map(el=>{
   const box=el.parentElement!.getBoundingClientRect();
   return {id:el.getAttribute('data-company-id')!,x:box.x+box.width/2,y:box.y+box.height/2};
 }).filter(point=>document.elementFromPoint(point.x,point.y) instanceof HTMLCanvasElement));
 let revealed=false;
 // Raycasting can hit a nearer point or edge in this dense graph. Inspect every
 // exposed candidate, and wait for React/WebGL hover state instead of assuming
 // it has committed after a fixed 80 ms on a busy CI runner.
 const highlightedIds=()=>page.locator('[data-highlighted="true"]').evaluateAll(els=>els.map(el=>el.getAttribute('data-company-id')).join());
 for(const point of hiddenPoints){
   const prior=await highlightedIds();
   await page.mouse.move(point.x,point.y);
   const label=page.locator(`[data-company-id="${point.id}"]`);
   // One pointer move commits its hover in a single render, so the first change is the result.
   await expect.poll(highlightedIds,{timeout:500,intervals:[50,100]}).not.toBe(prior).catch(()=>{});
   // Endpoints of a hovered edge are highlighted too, but only a hovered point reveals its
   // name; require this company to be the sole highlight so an edge hit is skipped.
   if(await highlightedIds()!==point.id)continue;
   // The reveal is applied by the next demand frame; allow a slow CI frame but still require it.
   await expect.poll(()=>label.evaluate(el=>getComputedStyle(el).visibility),{timeout:10000}).toBe('visible');
   await expect(label).toBeVisible();
   expect((await sides()).filter(node=>node.id!==point.id)).toEqual(held);
   revealed=true;break;
 }
 expect(revealed, `No hidden label revealed among ${hiddenPoints.length} exposed points`).toBe(true);
 await page.mouse.move(1,1);
 await expect.poll(sides).toEqual(held);
 await page.screenshot({path:'output/stable-rotation-'+test.info().project.name+'.png'});
});


test("company name emphasis scales gradually and respects reduced motion",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const label=page.locator('[data-company-id="US:NVDA"]');
 await expect(label).toBeVisible();
 await page.locator("canvas").scrollIntoViewIfNeeded();
 await expect(page.locator("canvas")).toHaveAttribute('data-camera','idle');
 const initial=await label.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue('--label-scale')));
 await revealMapSearch(page);
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.emulateMedia({reducedMotion:"no-preference"});
 const samples=page.evaluate(()=>new Promise<number[]>(resolve=>{
   const el=document.querySelector('[data-company-id="US:NVDA"]') as HTMLElement;
   const values:number[]=[];
   const observer=new MutationObserver(()=>values.push(parseFloat(el.style.getPropertyValue('--label-scale'))));
   observer.observe(el,{attributes:true,attributeFilter:['style']});
   setTimeout(()=>{observer.disconnect();resolve(values);},900);
 }));
 await page.getByRole("region",{name:"Search results",exact:true}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 const values=await samples;
 expect(new Set(values.filter(v=>v>initial+.01&&v<1.49)).size).toBeGreaterThan(2);
 await page.emulateMedia({reducedMotion:"reduce"});
 // Restore the full graph before comparing its overview with the initial one.
 await page.getByRole("button",{name:"Clear filters",exact:true}).click();
 await page.getByRole("button",{name:"Reset view",exact:true}).click();
 await page.mouse.move(1,1);
 await expect.poll(()=>label.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue('--label-scale')))).toBeCloseTo(initial,2);
});

test("company selection dims unrelated names and restores them on clear", async ({page}) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*", r => r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&company=US%3AAMD");
  const selected = page.locator('[data-company-id="US:AMD"]');
  await expect(selected).toHaveAttribute("data-company-focus", "selected");
  await expectGraphEmphasis(selected,1);
  const layout = layout3D(graph);
  const related = new Set(layout.edges.filter(e => e.source === "US:AMD" || e.target === "US:AMD").flatMap(e => [e.source,e.target]));
  const connected = layout.nodes.find(n => n.id !== "US:AMD" && related.has(n.id))!;
  const unrelated = layout.nodes.find(n => n.id !== "US:AMD" && !related.has(n.id))!;
  await expectGraphEmphasis(page.locator(`[data-company-id="${connected.id}"]`),1);
  const background = page.locator(`[data-company-id="${unrelated.id}"]`);
  await expect(background).toHaveAttribute("data-company-focus", "background");
  await expectGraphEmphasis(background,.18);
  await expect(page.locator("[data-company-id]")).toHaveCount(layout.nodes.length);
  const nextNode = page.locator('[data-company-focus="background"]:visible').first();
  const nextId = (await nextNode.getAttribute("data-company-id"))!;
  await nextNode.click({force:true});
  await expect(page.locator(`[data-company-id="${nextId}"]`)).toHaveAttribute("data-company-focus", "selected");
  await page.mouse.move(0,0);
  await expect(selected).toHaveAttribute("data-company-focus", "background");
  await expectGraphEmphasis(selected,.18);
  await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  await expect(page.locator("[data-company-focus]")).toHaveCount(0);
  await expectGraphEmphasis(background,1);
});

test("map displays stored market cap and date while unknown stays ticker only", async ({page}) => {
  const valued = structuredClone(graph);
  valued.nodes.find(n=>n.id==='US:NVDA')!.marketCap={value:1.25e12,currency:'USD',priceDate:'2026-09-21'};
  await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:valued}):r.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://graph.test/map?lang=en');
  const label=page.locator('[data-company-id="US:NVDA"]');
  await expect(label.locator('span')).toHaveText('NVDA · $1.25T');
  await expect(label).toHaveAttribute('title', /Estimated market cap: \$1.25T USD · As of 2026-09-21/);
  await expect(page.locator('[data-company-id="US:AAPL"] span')).toHaveText('AAPL');
});

test('three views default to graph, share filters and selection, and remember preference', async ({page}) => {
 test.setTimeout(60000);
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 const tree=page.getByRole('region',{name:'Horizontal tree',exact:true});
 await page.goto('http://graph.test/map?lang=en');
 await expect(page.getByRole('tab')).toHaveText(['Graph','Structure','List']);
 expect(await page.evaluate(()=>localStorage.getItem('ya-industry-view'))).toBeNull();
 await expect(page.getByRole('tab',{name:'Relationship graph',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await expect(tree.locator('[data-tree-node="root"]')).toHaveAttribute('aria-expanded','true');
 await expect(tree.locator('[data-tree-kind="layer"]')).toHaveCount(5);
 await expect(tree.locator('canvas')).toBeVisible();
 // The horizontal tree opens one level deep: every layer shows its branches, which stay closed.
 await expect(tree.locator('[data-tree-kind="layer"][aria-expanded="true"]')).toHaveCount(5);
 await expect(tree.locator('[data-tree-node="chips/compute"]')).toHaveAttribute('aria-expanded','false');
 await expect(tree.locator('[data-tree-company="US:NVDA"]').first()).not.toBeVisible();
 await tree.locator('[data-tree-node="chips/compute"]').click();
 await expect(tree.locator('[data-tree-company="US:NVDA"]').first()).toBeVisible();
 await tree.getByRole('button',{name:'Collapse all',exact:true}).click();
 await expect(tree.locator('[data-tree-company="US:NVDA"]').first()).not.toBeVisible();
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Search companies',exact:true})).toBeHidden();
 await expect(page.getByRole('region',{name:'AI companies and supply chain',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await revealListFilters(page);
 await page.getByLabel('Listing market',{exact:true}).selectOption('US');
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('NVDA');
 await expect(page.locator('[data-list-company]')).toHaveCount(1);
 await page.locator('[data-list-company="US:NVDA"] button').click();
 await expect(page.getByRole('complementary',{name:'Company details'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Search companies',exact:true})).toHaveValue('NVDA');
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
 await expect(page.locator('[data-company-id]')).toHaveCount(1);
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await page.goto('http://graph.test/map?lang=en');
 await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await expect(tree.locator('[data-tree-kind="layer"]')).toHaveCount(5);
 await page.waitForTimeout(1200);
 await page.screenshot({path:'output/three-views-tree-'+test.info().project.name+'.png',fullPage:true});
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await page.screenshot({path:'output/three-views-table-'+test.info().project.name+'.png',fullPage:true});
 for(const name of ['Industry structure','Relationship graph']) {
   await page.getByRole('tab',{name,exact:true}).click();
   await page.goto('http://graph.test/map?lang=en');
   await expect(page.getByRole('tab',{name,exact:true})).toHaveAttribute('aria-selected','true');
 }
});

test('three views support multi-role membership, sorting with unknown caps last, follows and empty results', async ({page}) => {
 const fixture:KnowledgeGraph={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD','US:AAPL'].includes(n.id)).map(n=>n.id==='US:NVDA'?{...n,stageIds:['compute','networking'],marketCap:{value:2e12,currency:'USD',priceDate:'2026-09-21'}}:n.id==='US:AMD'?{...n,marketCap:{value:1e12,currency:'USD',priceDate:'2026-09-21'}}:n)};
 await page.route('**/*',r=>{const path=new URL(r.request().url()).pathname;if(path==='/api/knowledge-graph')return r.fulfill({json:fixture});if(path==='/api/map-follows')return r.fulfill({json:{companyIds:['US:NVDA']}});return r.fulfill({contentType:'text/html',body:html});});
 const tree=page.getByRole('region',{name:'Horizontal tree',exact:true});
 await page.goto('http://graph.test/map?lang=en&account=1');
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 await expect(tree.locator('[data-tree-company="US:NVDA"]')).toHaveCount(2);
 // Keep the initialized renderer across tab switches instead of creating another WebGL context.
 await tree.locator('canvas').evaluate(canvas=>canvas.setAttribute('data-test-renderer','original'));
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await revealListFilters(page);
 await page.getByLabel('Industry role',{exact:true}).selectOption('connectivity');
 await expect(page.locator('[data-list-company]')).toHaveCount(1);
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByRole('button',{name:'Market value',exact:true}).click();
 await expect(page.locator('[data-list-company]').first()).toHaveAttribute('data-list-company','US:NVDA');
 await expect(page.locator('[data-list-company]').last()).toHaveAttribute('data-list-company','US:AAPL');
 await page.getByRole('button',{name:/Market value/}).click();
 await expect(page.locator('[data-list-company]').first()).toHaveAttribute('data-list-company','US:AMD');
 await expect(page.locator('[data-list-company]').last()).toHaveAttribute('data-list-company','US:AAPL');
 await revealListFilters(page);
 await page.getByLabel('Following only',{exact:true}).check();
 await expect(page.locator('[data-list-company]')).toHaveCount(1);
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await expect(tree.locator('canvas')).toHaveAttribute('data-test-renderer','original');
 await expect(tree.locator('[data-tree-company="US:AMD"]').first()).toBeVisible();
 await expect(page.getByLabel('Following only',{exact:true})).toBeHidden();
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await revealListFilters(page);
 await expect(page.getByLabel('Following only',{exact:true})).toBeChecked();
 await expect(page.locator('[data-list-company]')).toHaveCount(1);
 await revealMapSearch(page);
 await page.getByRole('textbox',{name:'Search companies',exact:true}).fill('no-such-company');
 await expect(page.getByText('No matching companies.',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 // Wait for the remounted 3D labels after clearing the empty search.
 await expect(tree.locator('[data-tree-company="US:AMD"]').first()).toBeVisible({timeout:20_000});
});

test('three views explicit relationship links open graph and tabs support keyboard', async ({page}) => {
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&relationship=sample');
 const tab=page.getByRole('tab',{name:'Relationship graph',exact:true});
 await expect(tab).toHaveAttribute('aria-selected','true');
 await tab.focus();await page.keyboard.press('Home');
 await expect(tab).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'Industry structure',exact:true})).toHaveAttribute('aria-selected','true');
});

test('three views selection and follow changes stay synchronized across tabs', async ({page}) => {
 let ids:string[]=[];
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||n.id==='US:NVDA')};
 await page.route('**/*',async r=>{const path=new URL(r.request().url()).pathname;if(path==='/api/knowledge-graph')return r.fulfill({json:fixture});if(path==='/api/map-follows'){if(r.request().method()==='PATCH')ids=['US:NVDA'];return r.fulfill({json:{companyIds:ids}});}return r.fulfill({contentType:'text/html',body:html});});
 const tree=page.getByRole('region',{name:'Horizontal tree',exact:true});
 await page.goto('http://graph.test/map?lang=en&account=1');
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 await tree.locator('[data-tree-company="US:NVDA"]').first().click();
 const detail=page.getByRole('dialog',{name:'Company details'});
 await expect(detail).toBeVisible();
 await detail.getByRole('button',{name:'＋ Follow',exact:true}).click();
 await expect(detail.getByRole('button',{name:'Following',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Company list',exact:true}).click();
 await expect(page.locator('[data-list-company="US:NVDA"]')).toHaveAttribute('data-selected','true');
 await expect(page.locator('[data-list-company="US:NVDA"]').getByLabel('Following',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
 await expect(page.locator('[data-company-id="US:NVDA"]')).toHaveAttribute('data-company-focus','selected');
 await expect(page.getByRole('complementary',{name:'Company details'}).getByRole('button',{name:'Following',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();await tree.scrollIntoViewIfNeeded();
 await expect(tree.locator('[data-tree-company="US:NVDA"]').first()).toHaveAttribute('aria-pressed','true');
});

test('three views 3D tree focuses branches, keeps flags and market caps, and supports pan, pinch and reset',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id)).map(n=>n.id==='US:NVDA'?{...n,country:'US',marketCap:{value:1e12,currency:'USD',priceDate:'2026-09-21'}}:n)};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/flags/')?r.fulfill({contentType:'image/svg+xml',body:readFileSync(process.cwd()+'/public/flags/us.svg')}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 // The horizontal tree follows the vertical one on the merged page; it starts WebGL once scrolled to.
 const tree=page.locator('[data-industry-section="horizontal"]');await tree.scrollIntoViewIfNeeded();
 await tree.locator('[data-tree-node="chips/compute"]').click();
 await expect(tree.locator('[data-tree-node="energy"]')).toHaveAttribute('data-tree-dimmed','true');
 const nvda=tree.locator('[data-tree-company="US:NVDA"]').first(),amd=tree.locator('[data-tree-company="US:AMD"]').first();
 await expect(nvda).toContainText('NVDA · $1T');
 await expect(nvda).toHaveAttribute('title',/2026-09-21/);
 await expect(nvda.locator('img')).toHaveAttribute('src','/flags/us.svg');
 await expect(nvda).toHaveAttribute('data-cap-scale','2.5');
 await expect(amd).toHaveAttribute('data-cap-scale','1');
 const canvas=tree.locator('canvas');
 await canvas.scrollIntoViewIfNeeded();
 const box=(await canvas.boundingBox())!;
 const before=(await nvda.boundingBox())!;
 const separation=()=>page.evaluate(()=>{const a=document.querySelector('[data-industry-section="horizontal"] [data-tree-company="US:NVDA"]')!.getBoundingClientRect(),b=document.querySelector('[data-industry-section="horizontal"] [data-tree-company="US:AMD"]')!.getBoundingClientRect();return {x:a.x-b.x,y:a.y-b.y};});
 const beforeSeparation=await separation();
 await page.mouse.move(box.x+box.width*.15,box.y+box.height*.85);
 await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.7,{steps:12});await page.mouse.up();
 await expect.poll(async()=>{const next=(await nvda.boundingBox())!;return Math.abs(next.x-before.x)+Math.abs(next.y-before.y);}).toBeGreaterThan(5);
 const afterSeparation=await separation();
 // Panning translates both nodes equally instead of rotating the hierarchy.
 await expect.poll(async()=>Math.abs((await separation()).x-beforeSeparation.x)).toBeLessThan(2);
 await expect.poll(async()=>Math.abs((await separation()).y-beforeSeparation.y)).toBeLessThan(2);
 const cdp=await page.context().newCDPSession(page);
 const x=box.x+box.width*.45,y=box.y+box.height*.45;
 const touch=(distance:number)=>[{x:x-distance,y,id:1},{x:x+distance,y,id:2}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(30)});
 for(let d=35;d<=65;d+=5)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(d)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(async()=>Math.abs((await separation()).y)).toBeGreaterThan(Math.abs(afterSeparation.y)*1.1);
 await expect.poll(async()=>Math.abs((await separation()).x)).toBeLessThan(2);
 await cdp.detach();
 await zoomWheel(page,-150);
 await tree.getByRole('button',{name:'Reset view',exact:true}).click();
 await expect(tree.locator('[data-tree-node="energy"]')).toHaveAttribute('data-tree-dimmed','false');
 await expect(nvda).toBeVisible();
 await page.screenshot({path:'output/three-views-expanded-'+test.info().project.name+'.png',fullPage:true});
 await tree.getByRole('button',{name:'Collapse all',exact:true}).click();
 await expect(tree.locator('[data-tree-company]')).toHaveCount(0);
 await expect(tree.locator('[data-tree-node="root"]')).toHaveAttribute('aria-expanded','false');
});

test('three views sizes an A-share leaf by its USD market cap and shows the CNY value',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const smicCap={value:120.6e9,currency:'USD' as const,priceDate:'2026-09-25',local:{value:856.2e9,currency:'CNY' as const,rateDate:'2026-09-24'}};
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['XSHG:688981','XSHG:688347'].includes(n.id)).map(n=>n.id==='XSHG:688981'?{...n,marketCap:smicCap}:n)};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.fulfill({contentType:'text/html',body:html}));
 for(const [lang,title] of [['en',/Estimated market cap: ¥856\.2B CNY \(≈ \$120\.6B USD\) · As of 2026-09-25/],['zh-CN',/估算市值: ¥8,562亿 CNY \(≈ \$120\.6B USD\) · 截至 2026-09-25/]] as const){
  await page.goto(`http://graph.test/map?lang=${lang}&view=tree`);
  const tree=page.locator('[data-industry-section="horizontal"]');await tree.scrollIntoViewIfNeeded();
  await tree.locator('[data-tree-node="chips/foundry"]').click();
  const smic=tree.locator('[data-tree-company="XSHG:688981"]').first(),huahong=tree.locator('[data-tree-company="XSHG:688347"]').first();
  await expect(smic).toContainText('688981 · $120.6B');
  await expect(smic).toHaveAttribute('data-cap-scale',String(Math.sqrt(1.206)));
  await expect(smic).toHaveAttribute('title',title);
  // A company without a stored estimate keeps the default leaf size.
  await expect(huahong).toHaveAttribute('data-cap-scale','1');
 }
});

test('three views tree remains browsable without WebGL',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){return type.includes('webgl')?null:Reflect.apply(original,this,[type,...args]);} as typeof original;});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const horizontal=page.getByRole('region',{name:'Horizontal tree',exact:true});
 await horizontal.scrollIntoViewIfNeeded();
 await expect(horizontal.getByRole('alert')).toContainText('3D is unavailable');
 // Layers start open one level deep; open a branch to reach its companies.
 await horizontal.locator('summary').filter({hasText:/^AI accelerators/}).click();
 await horizontal.getByRole('button',{name:'NVIDIA',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Company details'})).toHaveCount(1);
 await page.getByRole('button',{name:'Close company details'}).click();
 // The vertical tree on the same page has its own fallback and expand/collapse state.
 const vertical=page.getByRole('region',{name:'Vertical tree',exact:true});
 await vertical.scrollIntoViewIfNeeded();
 await expect(vertical.getByRole('alert')).toContainText('3D is unavailable');
 const chips=vertical.locator('details').filter({has:page.locator('summary').filter({hasText:/^Chips/})});
 const nvidia=chips.getByRole('button',{name:'NVIDIA',exact:true,includeHidden:true});
 await expect(nvidia).toBeVisible();
 await vertical.getByRole('button',{name:'Collapse all',exact:true}).click();
 await expect(nvidia).toBeHidden();
 await expect(horizontal.getByRole('button',{name:'NVIDIA',exact:true})).toBeVisible();
 await vertical.getByRole('button',{name:'Expand all',exact:true}).click();
 await expect(nvidia).toBeVisible();
 await vertical.locator('summary').filter({hasText:/^Chips/}).click();
 await expect(nvidia).toBeHidden();
 await vertical.locator('summary').filter({hasText:/^Chips/}).click();
 await expect(nvidia).toBeVisible();
});

test('three views application siblings share a vertical column and remain inside the canvas',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 // The horizontal tree follows the vertical one on the merged page; it starts WebGL once scrolled to.
 const tree=page.locator('[data-industry-section="horizontal"]');await tree.scrollIntoViewIfNeeded();
 // Layers start open, so the Applications branches are already showing.
 await expect(tree.locator('[data-tree-node="applications"]')).toHaveAttribute('aria-expanded','true');
 const software=tree.locator('[data-tree-node="applications/applications"]'),edge=tree.locator('[data-tree-node="applications/edge"]');
 await expect(software).toBeVisible();await expect(edge).toBeVisible();
 await expect.poll(async()=>{
   const a=(await software.boundingBox())!,b=(await edge.boundingBox())!,canvas=(await tree.locator('canvas').boundingBox())!;
   return Math.abs(a.x-b.x)<2&&a.y+a.height<b.y&&a.x+a.width<=canvas.x+canvas.width&&b.x+b.width<=canvas.x+canvas.width;
 }).toBe(true);
 await software.click();
 await expect(tree.locator('[data-tree-node="models"]')).toHaveAttribute('data-tree-dimmed','true');
 await expect(tree.locator('[data-tree-company="US:CRM"]')).toBeVisible();
 await page.screenshot({path:'output/tree-siblings-'+test.info().project.name+'.png',fullPage:true});
});

test('three views company snapshot stays inside the canvas and closes without losing the tree',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id))};
 await page.route('**/*',r=>{
  const url=r.request().url();
  if(url.includes('/api/company-fundamentals'))return r.fulfill({json:{data:{metrics:[{label:'Revenue',value:1000000000,unit:'USD',start:'2025-01-01',end:'2025-12-31'}],marketCap:{close:150,currency:'USD',priceDate:'2026-09-21'},report:{end:'2025-12-31'}}}});
  return url.includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://graph.test/map?lang=en&view=tree');
 // The horizontal tree follows the vertical one on the merged page; it starts WebGL once scrolled to.
 const tree=page.locator('[data-industry-section="horizontal"]');await tree.scrollIntoViewIfNeeded();
 await tree.locator('[data-tree-node="chips/compute"]').click();
 await tree.locator('[data-tree-company="US:NVDA"]').first().click();
 const card=page.getByRole('dialog',{name:'Company details'});
 await expect(card).toContainText('1B USD');
 await expect(card).toContainText('150 USD');
 await expect(card).toContainText('2026-09-21');
 await expect(page.getByRole('complementary',{name:'Company details'})).toHaveCount(0);
 const frame=(await tree.locator('[data-industry-tree]').boundingBox())!,box=(await card.boundingBox())!;
 expect(box.x).toBeGreaterThanOrEqual(frame.x);expect(box.y).toBeGreaterThanOrEqual(frame.y);
 expect(box.x+box.width).toBeLessThanOrEqual(frame.x+frame.width);expect(box.y+box.height).toBeLessThanOrEqual(frame.y+frame.height);
 await expect(tree.locator('[data-tree-company="US:AMD"]').first()).toHaveAttribute('data-tree-dimmed','true');
 await page.screenshot({path:'output/tree-card-'+test.info().project.name+'.png',fullPage:true});
 await card.getByRole('button',{name:'Close company details'}).click();
 await expect(card).toHaveCount(0);
 await expect(tree.locator('[data-tree-node="chips/compute"]')).toHaveAttribute('aria-expanded','true');
 await tree.locator('[data-tree-company="US:AMD"]').first().click();
 await expect(page.getByRole('dialog')).toContainText('AMD');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('three views expanding all preserves zoom and pan when company cards open and close',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id))};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 // The horizontal tree follows the vertical one on the merged page; it starts WebGL once scrolled to.
 const tree=page.locator('[data-industry-section="horizontal"]');await tree.scrollIntoViewIfNeeded();
 await tree.getByRole('button',{name:'Expand all',exact:true}).click();
 const node=tree.locator('[data-tree-company="US:NVDA"]').first(),canvas=tree.locator('canvas');
 await expect(node).toBeVisible();
 await canvas.scrollIntoViewIfNeeded();
 const box=(await canvas.boundingBox())!;
 const position=()=>page.evaluate(()=>{const n=document.querySelector('[data-industry-section="horizontal"] [data-tree-company="US:NVDA"]')!.getBoundingClientRect(),f=document.querySelector('[data-industry-tree="3d"]')!.getBoundingClientRect();return {x:n.x-f.x,y:n.y-f.y};});
 const initial=await position();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await zoomWheel(page,-120);
 await page.mouse.move(box.x+box.width*.12,box.y+box.height*.8);await page.mouse.down();await page.mouse.move(box.x+box.width*.18,box.y+box.height*.78,{steps:12});await page.mouse.up();
 await expect.poll(async()=>{const p=await position();return Math.abs(p.x-initial.x)+Math.abs(p.y-initial.y);}).toBeGreaterThan(5);
 // Wait for the camera's smoothing to settle, not a fixed animation delay.
 let previous=await position(),stable=0;
 await expect.poll(async()=>{const p=await position(),delta=Math.abs(p.x-previous.x)+Math.abs(p.y-previous.y);previous=p;stable=delta<.05?stable+1:0;return stable;},{intervals:[100,200,300]}).toBeGreaterThanOrEqual(3);
 const held=await position();
 const unchanged=async()=>{const p=await position();return Math.abs(p.x-held.x)+Math.abs(p.y-held.y);};
 await node.click();
 const card=page.getByRole('dialog',{name:'Company details'});await expect(card).toBeVisible();
 await expect(card.getByRole('status')).toHaveCount(0);
 await expect.poll(unchanged).toBeLessThan(1);
 await card.getByRole('button',{name:'Close company details'}).click();
 await expect(card).toHaveCount(0);await expect.poll(unchanged).toBeLessThan(1);
 await expect(tree.locator('[data-tree-node="chips/compute"]')).toHaveAttribute('aria-expanded','true');
});

test('three views industry structure stacks the vertical tree above the horizontal tree and shares company selection',async({page})=>{
 test.setTimeout(60000);
 await page.emulateMedia({reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=graph');
 await expect(page.getByRole('tab')).toHaveText(['Graph','Structure','List']);
 await page.getByRole('tab',{name:'Industry structure',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Industry structure',exact:true})).toHaveAttribute('aria-selected','true');
 const v=page.getByRole('region',{name:'Vertical tree',exact:true}),h=page.getByRole('region',{name:'Horizontal tree',exact:true});
 await expect(v.getByRole('heading',{name:'Vertical tree'})).toBeVisible();
 expect((await v.boundingBox())!.y).toBeLessThan((await h.boundingBox())!.y);
 // The lazy WebGL scene mounts labels incrementally on software renderers.
 await expect(v.locator('[data-tree-kind="layer"]')).toHaveCount(5,{timeout:15000});
 const root=(await v.locator('[data-tree-node="root"]').boundingBox())!;
 const apps=(await v.locator('[data-tree-node="applications"]').boundingBox())!;
 const energy=(await v.locator('[data-tree-node="energy"]').boundingBox())!;
 expect(energy.y+energy.height).toBeLessThan(root.y);
 expect(apps.y).toBeLessThan(root.y);
 expect(Math.abs(apps.x+apps.width/2-root.x-root.width/2)).toBeLessThan(2);
 const outsideCanvas=()=>page.evaluate(()=>{
  const canvas=document.querySelector('[data-industry-tree="vertical"] canvas')!.getBoundingClientRect();
  return [...document.querySelectorAll('[data-industry-tree="vertical"] [data-tree-node]')].filter(el=>{const r=el.getBoundingClientRect();return r.left<canvas.left-1||r.right>canvas.right+1||r.top<canvas.top-1||r.bottom>canvas.bottom+1;}).map(el=>el.getAttribute('data-tree-node'));
 });
 await expect.poll(outsideCanvas).toEqual([]);
 await page.screenshot({path:'output/vertical-tree-initial-'+test.info().project.name+'.png',fullPage:true});
 await expect(v.locator('[data-tree-node="applications"]')).toHaveAttribute('aria-expanded','true');
 const software=v.locator('[data-tree-node="applications/applications"]'),edge=v.locator('[data-tree-node="applications/edge"]');
 await expect(software).toBeVisible();await expect(edge).toBeVisible();
 await expect(software).toHaveAttribute('aria-expanded','true');
 // Selecting in the vertical tree opens one card there and highlights the company in both trees.
 await v.locator('[data-tree-company="US:CRM"]').click();
 await expect(page.getByRole('dialog')).toHaveCount(1);await expect(v.getByRole('dialog')).toContainText('CRM');
 await expect(page.getByRole('complementary',{name:'Company details'})).toHaveCount(0);
 await h.scrollIntoViewIfNeeded();
 await expect(h.locator('[data-tree-node="applications"]')).toHaveAttribute('aria-expanded','true');
 await expect(h.locator('[data-tree-node="applications/applications"]')).toHaveAttribute('aria-expanded','false');
 await h.locator('[data-tree-node="applications/applications"]').click();
 await expect(h.locator('[data-tree-company="US:CRM"]').first()).toHaveAttribute('aria-pressed','true');
 await expect(v.locator('[data-tree-company="US:CRM"]')).toHaveAttribute('aria-pressed','true');
 // Selecting in the horizontal tree moves the one card there and updates the highlight in the vertical tree.
 await h.locator('[data-tree-node="chips/compute"]').click();
 await h.locator('[data-tree-company="US:NVDA"]').first().click();
 await expect(page.getByRole('dialog')).toHaveCount(1);await expect(h.getByRole('dialog')).toContainText('NVIDIA');
 await expect(v.locator('[data-tree-company="US:NVDA"]').first()).toHaveAttribute('aria-pressed','true');
 await expect(v.locator('[data-tree-company="US:CRM"]')).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Close company details'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 // Each tree keeps its own expand/collapse state.
 await v.getByRole('button',{name:'Collapse all'}).click();await expect(v.locator('[data-tree-kind="layer"]')).toHaveCount(0);
 await expect(h.locator('[data-tree-kind="layer"]')).toHaveCount(5);
 await v.getByRole('button',{name:'Expand all'}).click();await expect(v.locator('[data-tree-company]').first()).toBeVisible();
 await v.scrollIntoViewIfNeeded();
 await expect.poll(outsideCanvas).toEqual([]);
 await page.screenshot({path:'output/vertical-tree-all-'+test.info().project.name+'.png',fullPage:true});
 const tab=(name:string)=>page.getByRole('tab',{name,exact:true});
 await tab('Industry structure').focus();
 await page.keyboard.press('ArrowRight');await expect(tab('Company list')).toHaveAttribute('aria-selected','true');await expect(tab('Company list')).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(tab('Relationship graph')).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('ArrowLeft');await expect(tab('Company list')).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('Home');await expect(tab('Relationship graph')).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('ArrowRight');await expect(tab('Industry structure')).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('End');await expect(tab('Company list')).toHaveAttribute('aria-selected','true');
 expect(errors).toEqual([]);
});

test('three views selections made outside the trees open the card in the vertical tree, in view',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id))};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const v=page.getByRole('region',{name:'Vertical tree',exact:true}),h=page.getByRole('region',{name:'Horizontal tree',exact:true});
 const tab=(name:string)=>page.getByRole('tab',{name,exact:true});
 const pickInHorizontal=async(id:string,name:string)=>{
  await h.scrollIntoViewIfNeeded();
  // Each tree keeps its expansion across tab switches; open Chips › compute only if needed.
  const chips=h.locator('[data-tree-node="chips"]');await expect(chips).toBeVisible();
  if(await chips.getAttribute('aria-expanded')!=='true')await chips.click();
  const compute=h.locator('[data-tree-node="chips/compute"]');await expect(compute).toBeVisible();
  if(await compute.getAttribute('aria-expanded')!=='true')await compute.click();
  await h.locator(`[data-tree-company="${id}"]`).first().click();
  // Picking inside a tree keeps the card in that tree.
  await expect(h.getByRole('dialog')).toContainText(name);await expect(v.getByRole('dialog')).toHaveCount(0);
 };
 const expectCardInVerticalTree=async(name:string)=>{
  await expect(tab('Industry structure')).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('dialog',{name:'Company details'})).toHaveCount(1);
  const card=v.getByRole('dialog',{name:'Company details'});
  await expect(card).toContainText(name);
  await expect(card).toBeInViewport();
  await expect(h.getByRole('dialog')).toHaveCount(0);
 };
 // Company list: pick in the horizontal tree, then select another company in the list.
 await pickInHorizontal('US:NVDA','NVIDIA');
 await tab('Company list').click();
 // On phones the list's own details panel overlays the rows; close it as a user would.
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();
 await page.locator('[data-list-company="US:AMD"] button').click();
 await tab('Industry structure').click();
 await expectCardInVerticalTree('AMD');
 // Relationship graph: the same, choosing the company from the graph's company browser.
 await pickInHorizontal('US:AMD','AMD');
 await tab('Relationship graph').click();
 const browser=page.locator('details').filter({has:page.locator('summary',{hasText:'Browse companies'})});
 await browser.locator('summary').click();
 await browser.getByRole('button',{name:/NVIDIA/}).click();
 await tab('Industry structure').click();
 await expectCardInVerticalTree('NVIDIA');
});

test('three views legacy vertical links and preferences open the merged industry structure',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=vertical');
 await expect(page.getByRole('tab',{name:'Industry structure',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('[data-industry-tree="vertical"] canvas')).toBeVisible();
 await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe('tree');
 // The lower tree starts WebGL only once it scrolls into view.
 await expect(page.locator('[data-industry-tree="3d"] canvas')).toHaveCount(0);
 await page.locator('[data-industry-section="horizontal"]').scrollIntoViewIfNeeded();
 await expect(page.locator('[data-industry-tree="3d"] canvas')).toHaveCount(1);
 // Vertical swipes on either canvas scroll the page instead of being trapped by the camera.
 expect(await page.locator('[data-industry-tree] canvas').evaluateAll(els=>els.map(el=>getComputedStyle(el).touchAction))).toEqual(['pan-y','pan-y']);
 await page.evaluate(()=>localStorage.setItem('ya-industry-view','vertical'));
 await page.goto('http://graph.test/map?lang=en');
 await expect(page.getByRole('tab',{name:'Industry structure',exact:true})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('ya-industry-view'))).toBe('tree');
});

// Above ground companies are leaves; on the Energy roots they are nodules. Both select like their label button.
for(const [id,part] of [['US:NVDA','leaf body'],['US:CEG','root nodule']]) test(`three views vertical ${part} selects its company when zoomed out`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 // One company, so every hit belongs to it.
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||n.id===id)};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const node=page.locator(`[data-tree-company="${id}"]`).first(),canvas=page.locator('[data-industry-tree="vertical"] canvas');
 await expect(node).toHaveAttribute('data-compact','true');
 await canvas.scrollIntoViewIfNeeded();
 // Park the pointer away from the stem so its label is not hover-expanded.
 const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+4,box.y+4);
 const measure=()=>node.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,radius:r.width/2};});
 // Wait for the labels to settle on their stems.
 let stem=await measure(),stable=0;
 await expect.poll(async()=>{const p=await measure(),moved=Math.abs(p.x-stem.x)+Math.abs(p.y-stem.y);stem=p;stable=moved<.05?stable+1:0;return stable;},{intervals:[100,200,300]}).toBeGreaterThanOrEqual(3);
 // Scan around the stem: over the leaf or nodule, only the canvas is under the pointer and it shows a pointer cursor.
 const hits:{x:number;y:number}[]=[];
 for(let dy=-16;dy<=16;dy++)for(let dx=-16;dx<=16;dx++){
  const x=stem.x+dx,y=stem.y+dy;
  if(Math.hypot(dx,dy)<=stem.radius+1.5)continue;
  await page.mouse.move(x,y);
  if(await page.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);return el instanceof HTMLCanvasElement&&el.style.cursor==='pointer';},[x,y]))hits.push({x,y});
 }
 // It is clickable outside the stem button, which was all that was clickable before.
 // Click the middle of that area rather than an edge pixel.
 expect(hits.length).toBeGreaterThan(0);
 const cx=hits.reduce((t,h)=>t+h.x,0)/hits.length,cy=hits.reduce((t,h)=>t+h.y,0)/hits.length;
 const target=hits.reduce((a,b)=>Math.hypot(b.x-cx,b.y-cy)<Math.hypot(a.x-cx,a.y-cy)?b:a);
 await page.mouse.click(target.x,target.y);
 const card=page.getByRole('dialog',{name:'Company details'});
 await expect(card).toBeVisible();await expect(card).toContainText(id.split(':')[1]);
 await expect(node).toHaveAttribute('aria-pressed','true');
});

test('three views vertical defaults to expanded and preserves zoom and pan when company cards open and close',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id))};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const node=page.locator('[data-tree-company="US:NVDA"]').first(),canvas=page.locator('[data-industry-tree="vertical"] canvas');
 await expect(node).toBeVisible();
 await canvas.scrollIntoViewIfNeeded();
 const box=(await canvas.boundingBox())!;
 // Measure the projected node anchor: hovering/selecting a compact marker can
 // expand its label without moving the camera or the underlying company.
 const position=()=>node.evaluate(el=>{const m=new DOMMatrixReadOnly(el.parentElement!.parentElement!.parentElement!.style.transform);return {x:m.m41,y:m.m42};});
 const initial=await position();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await zoomWheel(page,-120);
 await page.mouse.move(box.x+box.width*.12,box.y+box.height*.8);await page.mouse.down();await page.mouse.move(box.x+box.width*.18,box.y+box.height*.78,{steps:12});await page.mouse.up();
 await expect.poll(async()=>{const p=await position();return Math.abs(p.x-initial.x)+Math.abs(p.y-initial.y);}).toBeGreaterThan(5);
 // Wait for the camera's smoothing to settle, not a fixed animation delay.
 let previous=await position(),stable=0;
 await expect.poll(async()=>{const p=await position(),delta=Math.abs(p.x-previous.x)+Math.abs(p.y-previous.y);previous=p;stable=delta<.05?stable+1:0;return stable;},{intervals:[100,200,300]}).toBeGreaterThanOrEqual(3);
 const held=await position();
 const unchanged=async()=>{const p=await position();return Math.abs(p.x-held.x)+Math.abs(p.y-held.y);};
 await node.click();
 const card=page.getByRole('dialog',{name:'Company details'});await expect(card).toBeVisible();
 await expect(card.getByRole('status')).toHaveCount(0);
 await expect.poll(unchanged).toBeLessThan(1);
 await card.getByRole('button',{name:'Close company details'}).click();
 await expect(card).toHaveCount(0);await expect.poll(unchanged).toBeLessThan(1);
 await expect(page.locator('[data-industry-section="vertical"] [data-tree-node="chips/compute"]')).toHaveAttribute('aria-expanded','true');
});

// Both trees are taller than most screens: a plain mouse wheel must scroll past them, not zoom.
for(const section of ['vertical','horizontal'] as const) test(`three views ${section} tree: plain wheel scrolls the page, ctrl + wheel zooms`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const fixture={...graph,nodes:graph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD'].includes(n.id))};
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:fixture}):r.request().url().includes('/api/company-fundamentals')?r.fulfill({json:{data:null}}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const scope=`[data-industry-section="${section}"]`,tree=page.locator(scope),canvas=tree.locator('canvas');
 await tree.scrollIntoViewIfNeeded();await expect(canvas).toBeVisible();
 // Measure a node away from the dolly centre so zooming visibly moves it.
 const node=tree.locator('[data-tree-node="applications"]');await expect(node).toBeVisible();
 const hint=tree.locator('[data-wheel-zoom-hint]');
 await expect(hint).toHaveAttribute('data-visible','false');
 const offset=()=>page.evaluate(scope=>{const n=document.querySelector(scope+' [data-tree-node="applications"]')!.getBoundingClientRect(),f=document.querySelector(scope+' [data-industry-tree]')!.getBoundingClientRect();return {x:n.x-f.x,y:n.y-f.y};},scope);
 const settle=async()=>{let previous=await offset(),stable=0;await expect.poll(async()=>{const p=await offset(),delta=Math.abs(p.x-previous.x)+Math.abs(p.y-previous.y);previous=p;stable=delta<.05?stable+1:0;return stable;},{intervals:[100,200,300]}).toBeGreaterThanOrEqual(3);return previous;};
 const pointer=async()=>{const box=(await canvas.boundingBox())!,top=Math.max(box.y,0);await page.mouse.move(box.x+box.width*.5,top+Math.min(120,(box.y+box.height-top)/2));};
 // Fit once the labels have mounted, so the baseline matches what Reset view restores.
 await tree.getByRole('button',{name:'Reset view',exact:true}).click();
 const initial=await settle();
 const scrollY=()=>page.evaluate(()=>window.scrollY);
 await pointer();const before=await scrollY();
 await page.mouse.wheel(0,250);
 await expect.poll(scrollY).toBeGreaterThan(before);
 await expect(hint).toHaveAttribute('data-visible','true');
 await expect(hint).toHaveText(/(Ctrl|⌘) \+ scroll to zoom/);
 // The camera did not move: the node keeps its place inside the tree frame.
 const held=await settle();expect(Math.abs(held.x-initial.x)+Math.abs(held.y-initial.y)).toBeLessThan(1);
 await expect(hint).toHaveAttribute('data-visible','false');
 await pointer();const kept=await scrollY();
 await zoomWheel(page,-250);
 await expect.poll(async()=>{const p=await offset();return Math.abs(p.x-held.x)+Math.abs(p.y-held.y);}).toBeGreaterThan(5);
 expect(await scrollY()).toBe(kept);
 await expect(hint).toHaveAttribute('data-visible','false');
 // Reset view still restores the fitted camera after zooming.
 await tree.getByRole('button',{name:'Reset view',exact:true}).click();
 await expect.poll(async()=>{const p=await offset();return Math.abs(p.x-initial.x)+Math.abs(p.y-initial.y);}).toBeLessThan(2);
});

test('relationship graph: plain wheel scrolls the page and shows the zoom hint',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en');
 const label=page.locator('button[class*="label3d"]').filter({hasText:"NVIDIA"}).locator("strong");
 await expect(label).toBeVisible();
 const fontSize=()=>label.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 const initial=await fontSize();
 await page.locator('canvas').hover({position:{x:20,y:100}});
 const before=await page.evaluate(()=>window.scrollY);
 await page.mouse.wheel(0,300);
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
 await expect(page.locator('[data-wheel-zoom-hint][data-visible="true"]')).toHaveCount(1);
 expect(await fontSize()).toBe(initial);
 await expect(page.getByText('Drag: orbit · Right-drag: pan · Ctrl + scroll / pinch: zoom',{exact:true})).toBeVisible();
});

test('three views horizontal tree opens one level deep with the root label clear of every layer label',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().includes('/api/knowledge-graph')?r.fulfill({json:graph}):r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://graph.test/map?lang=en&view=tree');
 const h=page.locator('[data-industry-section="horizontal"]');await h.scrollIntoViewIfNeeded();
 await expect(h.locator('[data-tree-kind="layer"][aria-expanded="true"]')).toHaveCount(5);
 await expect(h.locator('[data-tree-kind="branch"]')).toHaveCount(await h.locator('[data-tree-kind="branch"]').count());
 expect(await h.locator('[data-tree-kind="branch"]').count()).toBeGreaterThan(5);
 await expect(h.locator('[data-tree-company]')).toHaveCount(0);
 const overlaps=()=>page.evaluate(()=>{
  const scope='[data-industry-section="horizontal"]',canvas=document.querySelector(scope+' canvas')!.getBoundingClientRect();
  const box=(el:Element)=>el.getBoundingClientRect(),root=box(document.querySelector(scope+' [data-tree-node="root"]')!);
  const hit=(a:DOMRect,b:DOMRect)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  const labels=[...document.querySelectorAll(scope+' [data-tree-kind="layer"]')].filter(el=>hit(root,box(el))).map(el=>el.getAttribute('data-tree-node'));
  if(root.left<canvas.left-1||root.right>canvas.right+1)labels.push('outside canvas');
  return labels;
 });
 await expect.poll(overlaps).toEqual([]);
 await page.screenshot({path:'output/horizontal-tree-initial-'+test.info().project.name+'.png',fullPage:true});
 // Tree controls are compact icon buttons with accessible names and tooltips.
 for(const name of ['Expand all','Collapse all','Reset view'])await expect(h.getByRole('button',{name,exact:true})).toHaveAttribute('title',name);
});

