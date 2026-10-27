import { isBuiltin } from 'node:module';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// esbuild keeps package imports external. Retain their complete npm dependency
// trees, including dynamic requires/assets, rather than pruning individual files.
export function runtimeManifest(manifest, metafiles) {
  if (!metafiles.length) throw new Error('Worker dependency metadata is required');
  const required = new Set();
  for (const meta of metafiles) {
    if (!meta.outputs || !Object.keys(meta.outputs).length) throw new Error('Empty worker output metadata');
    for (const output of Object.values(meta.outputs)) {
      for (const item of output.imports ?? []) {
        if (!item.external || isBuiltin(item.path)) continue;
        if (!/^(@[\w.-]+\/)?[\w.-]+(?:\/.*)?$/.test(item.path) || item.path.startsWith('.')) throw new Error(`Unsupported external worker import: ${item.path}`);
        const name = item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0];
        if (!Object.hasOwn(manifest.dependencies ?? {}, name)) throw new Error(`Worker package is not a production dependency: ${name}`);
        required.add(name);
      }
    }
  }
  if (!required.size) throw new Error('Worker has no resolved runtime packages');
  return { ...manifest, dependencies: Object.fromEntries([...required].sort().map(name => [name, manifest.dependencies[name]])), devDependencies: {} };
}

export function pruneInstalledPackages(directory, roots) {
  const modules = realpathSync(directory), application = path.dirname(modules);
  const visited = new Set(), retained = new Set();
  function resolve(name, parent) {
    if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error(`Invalid package name: ${name}`);
    for (let current = parent; current === application || current.startsWith(application + path.sep); current = path.dirname(current)) {
      const candidate = path.join(current, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    }
  }
  function visit(name, parent, optional = false) {
    const location = resolve(name, parent);
    if (!location) { if (optional) return; throw new Error(`Missing runtime dependency: ${name}`); }
    if (!location.startsWith(modules + path.sep)) throw new Error('Runtime dependency escapes node_modules');
    if (visited.has(location)) return;
    visited.add(location);
    const relative = path.relative(modules, location).split(path.sep);
    retained.add(relative.slice(0, relative[0].startsWith('@') ? 2 : 1).join(path.sep));
    const pkg = JSON.parse(readFileSync(path.join(location, 'package.json'), 'utf8'));
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    for (const dependency of names) visit(dependency, location,
      Object.hasOwn(pkg.optionalDependencies ?? {}, dependency) || pkg.peerDependenciesMeta?.[dependency]?.optional === true);
  }
  // Resolve and validate the complete graph before removing anything.
  for (const root of roots) visit(root, application);
  if (!retained.size) throw new Error('Refusing to prune an empty runtime graph');
  const removed = [];
  const entries = readdirSync(modules).filter(name => !name.startsWith('.')).flatMap(name => name.startsWith('@')
    ? readdirSync(path.join(modules, name)).map(child => path.join(name, child)) : [name]);
  for (const entry of entries) if (!retained.has(entry)) {
    const target = path.resolve(modules, entry);
    if (!target.startsWith(modules + path.sep)) throw new Error('Invalid prune target');
    if (!realpathSync(target).startsWith(modules + path.sep)) throw new Error('Prune target escapes node_modules');
    rmSync(target, { recursive: true, force: true });
    removed.push(entry);
  }
  return { retained: [...retained].sort(), removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readdirSync('dist').filter(file => file.endsWith('.meta.json'));
  const manifest = runtimeManifest(JSON.parse(readFileSync('package.json', 'utf8')),
    files.map(file => JSON.parse(readFileSync(`dist/${file}`, 'utf8'))));
  const result = pruneInstalledPackages('node_modules', Object.keys(manifest.dependencies));
  writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Worker runtime packages: ${Object.keys(manifest.dependencies).join(', ')}`);
  console.log(`Retained ${result.retained.length} complete packages; removed ${result.removed.length} unrelated packages.`);
}
