import {expect,test} from '@playwright/test';
import probe from '../../scripts/graph-readiness-probe.cjs';
const {installGraphReadinessProbe}=probe;

test('candidate timing ignores a blank canvas until the scene reports a frame',async({page})=>{
 await page.addInitScript(installGraphReadinessProbe);
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas></canvas>'}));
 await page.goto('http://performance.test/');
 await expect(page.locator('canvas')).toBeVisible();
 await page.waitForTimeout(100);
 expect(await page.evaluate(()=>Reflect.get(window,'__releaseGraphReadyAt'))).toBeNull();
 await page.evaluate(()=>document.querySelector('canvas')!.setAttribute('data-camera-position','0,0,100'));
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__releaseGraphReadyAt'))).toBeGreaterThan(0);
});

test('feed timing waits for the pending state to finish and accepts an empty feed',async({page})=>{
 await page.addInitScript(installGraphReadinessProbe);
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><p role="status">Loading events and sources…</p><canvas data-camera-position="0,0,100"></canvas>'}));
 await page.goto('http://performance.test/');
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__releaseGraphReadyAt'))).toBeGreaterThan(0);
 expect(await page.evaluate(()=>Reflect.get(window,'__releaseFeedReadyAt'))).toBeNull();
 await page.evaluate(()=>{document.querySelector('p')!.remove();document.body.insertAdjacentHTML('beforeend','<div id="intelligence-event-stream"></div>');});
 await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'__releaseFeedReadyAt'))).toBeGreaterThan(0);
});
