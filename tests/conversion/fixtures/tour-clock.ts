import { readFileSync } from 'node:fs';
import type { Plugin } from 'esbuild';
import type { Page } from '@playwright/test';
import { TOUR_IDLE_RESUME_MS } from '../../../src/lib/ui/knowledge-graph/tour-motion';

// Only the in-memory component fixture imports this plugin. Production has no
// test flag or alternate timing. Accelerate tour entry points, not nested delta
// helpers, CSS fades or damping. The idle-resume deadline stays real unless a
// test opts into shortenIdleResume.
export const tourClockPlugin: Plugin = {
  name: 'fixture-tour-clock',
  setup(build) {
    build.onLoad({filter: /(?:company-graph-3d|industry-tree-scene)\.tsx$/}, ({path}) => {
      const source=readFileSync(path,'utf8');
      const entry=path.endsWith('company-graph-3d.tsx')
        ? 'introPath.current(delta, controls.current.polarAngle, speed)'
        : 'presentation.current(delta,navigation.speed)';
      if(!source.includes(entry))throw new Error(`Tour fixture entry point changed: ${path}`);
      const scaled=entry.replace(/speed\)$/, 'speed * (globalThis.__fixtureTourRate ?? 1))');
      return {loader:'tsx',contents:source.replace(entry,scaled)};
    });
    build.onLoad({filter: /knowledge-graph[\\/]tour-motion\.ts$/}, ({path}) => {
      const source=readFileSync(path,'utf8');
      const entry=`export const TOUR_IDLE_RESUME_MS = ${TOUR_IDLE_RESUME_MS};`;
      if(!source.includes(entry))throw new Error(`Idle-resume fixture entry point changed: ${path}`);
      return {loader:'ts',contents:source.replace(entry,`export const TOUR_IDLE_RESUME_MS = ${TOUR_IDLE_RESUME_MS} * (globalThis.__fixtureIdleScale ?? 1);`)};
    });
  },
};

export async function accelerateTours(page:Page,rate=8) {
  await page.addInitScript(value=>{Object.assign(globalThis,{__fixtureTourRate:value});},rate);
}

// Only for tests that check what happens after the deadline, never within it.
export async function shortenIdleResume(page:Page,scale=.125) {
  await page.addInitScript(value=>{Object.assign(globalThis,{__fixtureIdleScale:value});},scale);
}

/** Waits past the page's idle-resume deadline, real or shortened, by `margin` ms. */
export async function pastIdleResume(page:Page,margin=300) {
  const scale=await page.evaluate(()=>(globalThis as {__fixtureIdleScale?:number}).__fixtureIdleScale??1);
  await page.waitForTimeout(TOUR_IDLE_RESUME_MS*scale+margin);
}
