import { readFileSync } from 'node:fs';
import type { Plugin } from 'esbuild';
import type { Page } from '@playwright/test';

// Only the in-memory component fixture imports this plugin. Production has no
// test flag or alternate timing. Accelerate tour entry points, not nested delta
// helpers, CSS fades, damping, or the real idle-resume timer.
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
  },
};

export async function accelerateTours(page:Page,rate=8) {
  await page.addInitScript(value=>{Object.assign(globalThis,{__fixtureTourRate:value});},rate);
}
