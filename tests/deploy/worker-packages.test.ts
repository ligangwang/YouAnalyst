import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeManifest, pruneInstalledPackages } from '../../scripts/prune-worker-dependencies.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const manifest = { name: 'worker', dependencies: { 'firebase-admin': '^13', 'better-sqlite3': '12', '@scope/pkg': '1', next: '16', react: '19' }, devDependencies: { esbuild: '1' } };
const metadata = (...paths: string[]) => ({ outputs: { 'dist/worker.cjs': { imports: paths.map(path => ({ path, external: true })) } } });

test('runtime roots include package subpaths and scoped packages, without browser packages or builtins', () => {
  const actual = runtimeManifest(manifest, [metadata('node:fs', 'node:assert/strict', 'firebase-admin/app'), metadata('better-sqlite3', '@scope/pkg/subpath')]);
  assert.deepEqual(actual.dependencies, { '@scope/pkg': '1', 'better-sqlite3': '12', 'firebase-admin': '^13' });
  assert.deepEqual(actual.devDependencies, {});
  assert(manifest.dependencies.next);
});

test('missing, malformed, and undeclared imports block packaging rather than dropping dependencies', () => {
  for (const metas of [[], [{}], [metadata('esbuild')], [metadata('./external.cjs')], [metadata('node:fs')]]) {
    assert.throws(() => runtimeManifest(manifest, metas));
  }
});

test('pruning retains complete nested, scoped, peer, and asset dependencies', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'worker-packages-'));
  const modules = path.join(root, 'node_modules');
  function pkg(name: string, value: object = {}) {
    const dir = path.join(modules, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(value));
    writeFileSync(path.join(dir, 'asset.txt'), 'runtime data');
  }
  try {
    pkg('backend', { dependencies: { nested: '1', '@scope/shared': '1' }, peerDependencies: { peer: '1' }, optionalDependencies: { absent: '1' } });
    pkg('backend/node_modules/nested'); pkg('@scope/shared'); pkg('peer'); pkg('next'); pkg('react');
    const result = pruneInstalledPackages(modules, ['backend']);
    assert.deepEqual(result.removed.sort(), ['next', 'react']);
    assert(existsSync(path.join(modules, 'backend/node_modules/nested/asset.txt')));
    assert(existsSync(path.join(modules, '@scope/shared/asset.txt')));
    assert(existsSync(path.join(modules, 'peer/asset.txt')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an incomplete dependency graph fails before deleting unrelated packages', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'worker-packages-'));
  const modules = path.join(root, 'node_modules');
  try {
    for (const name of ['backend', 'next']) {
      mkdirSync(path.join(modules, name), { recursive: true });
      writeFileSync(path.join(modules, name, 'package.json'), JSON.stringify({ dependencies: name === 'backend' ? { missing: '1' } : {} }));
    }
    assert.throws(() => pruneInstalledPackages(modules, ['backend']), /Missing runtime dependency/);
    assert(existsSync(path.join(modules, 'next/package.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
