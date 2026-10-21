import {readFile, writeFile} from 'node:fs/promises';
import {validateCniDirectory} from '../src/lib/industry-research/directory-sync';
import {buildCniCatalog} from '../src/lib/industry-classification/cni';
import type {ClassificationEntry} from '../src/lib/industry-classification/model';

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw Error('Usage: tsx scripts/export-cni-taxonomy.ts snapshot.json catalog.json');
  const {payload, rows} = validateCniDirectory(JSON.parse(await readFile(input, 'utf8')));
  const catalog = buildCniCatalog(String(payload.source), String(payload.snapshot), rows as {classification: ClassificationEntry[]}[]);
  // Immutable versions: never silently overwrite a previously reviewed catalog.
  await writeFile(output, JSON.stringify(catalog, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  console.log(JSON.stringify({version: catalog.version, nodes: catalog.nodes.length}));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Catalog export failed'); process.exitCode = 1; });
