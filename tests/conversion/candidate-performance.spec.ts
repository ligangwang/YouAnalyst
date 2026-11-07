import {expect,test} from '@playwright/test';
import {installGraphReadinessProbe} from '../../scripts/verify-candidate-performance.mjs';

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
