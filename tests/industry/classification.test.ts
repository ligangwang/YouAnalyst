import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCniCatalog, cniMetadata} from '../../src/lib/industry-classification/cni';
import {classificationPath, validateCatalog, validateMappings, type TaxonomyCatalog, type IndustryMappingFile} from '../../src/lib/industry-classification/model';
import {secCompanySyncPatch, buildSecCatalog, indexSecBulk, parseSecClassification, secClassificationPatch} from '../../src/lib/industry-classification/sec';

const source = 'https://www.cnindex.com.cn/zh_information/data_resource/fljg/test.xlsx';
const path = ['01', '0101', '010101', '01010101'].map(code => ({code, name: code}));
const cni = () => buildCniCatalog(source, '2026-9', [{classification: path}]);
const sic: TaxonomyCatalog = {taxonomy: 'SIC', version: 'test', sourceUrl: 'https://www.osha.gov/data/sic-manual', nodes: [
  {code: '01', name: 'Example parent', translations: {}, level: 'majorGroup', parentCode: null},
  {code: '0111', name: 'Example child', translations: {}, level: 'industry', parentCode: '01'},
]};

test('bulk SEC indexing excludes ambiguous tickers and normalizes share-class symbols', () => {
  const rows = [
    {cik: 1, sic: '3674', sicDescription: 'Semiconductors', tickers: ['BRK-B', 'SHARED']},
    {cik: 2, sic: '', tickers: ['SHARED', 'NONE']},
  ];
  const index = indexSecBulk(rows);
  assert.equal(index.tickers.get('BRK.B'), '0000000001');
  assert.equal(index.tickers.has('SHARED'), false);
  assert.equal(index.ambiguous.has('SHARED'), true);
  assert.equal(index.issuers.get('0000000002'), null);
  assert.throws(() => indexSecBulk([rows[0], rows[0]]), /Duplicate/);
});

test('SEC assignments validate issuer identity, preserve source labels and zero-pad codes', () => {
  assert.deepEqual(parseSecClassification({cik: 1, sic: 100, sicDescription: 'Agricultural Production-Crops'}, '0000000001'), {code: '0100', name: 'Agricultural Production-Crops'});
  assert.equal(parseSecClassification({cik: 1, sic: ''}, '0000000001'), null);
  assert.throws(() => parseSecClassification({cik: 2, sic: 100, sicDescription: 'Name'}, '0000000001'), /mismatch/);
  assert.throws(() => parseSecClassification({cik: 1, sic: 100}, '0000000001'), /Invalid/);
});

test('SEC patches avoid observation-only writes, preserve other taxonomies and deleted records', () => {
  const entry = {code: '3674', name: 'Semiconductors & Related Devices'};
  const catalog = buildSecCatalog([entry, entry]);
  assert.equal(catalog.nodes.length, 1);
  assert.equal(catalog.nodes[0].parentCode, null);
  const patch = secClassificationPatch({}, entry, '0000000001', catalog.version, '2026-10-21T00:00:00Z')!;
  assert.deepEqual(patch.classification, [entry.code]);
  assert.equal(secClassificationPatch({...patch}, entry, '0000000001', 'another-catalog', '2026-10-22T00:00:00Z'), null);
  assert.equal(secClassificationPatch({isDeleted: true}, entry, '0000000001', catalog.version, '2026-10-21T00:00:00Z'), null);
  assert.throws(() => secClassificationPatch({taxonomy: 'CNI'}, entry, '0000000001', catalog.version, '2026-10-21T00:00:00Z'), /another taxonomy/);
  assert.throws(() => buildSecCatalog([entry, {...entry, name: 'Conflicting label'}]), /Conflicting/);
});

test('CNI catalogs preserve source paths and leading zeros; provenance separates snapshot from version', () => {
  assert.deepEqual(classificationPath(cni(), '01010101'), path);
  assert.equal(cni().nodes.length, 4);
  assert.deepEqual(cniMetadata(source, '2026-9', '2026-10-21T00:00:00Z'), {
    catalogVersion: 'cni-directory-2026-09', sourceUrl: source, sourceSnapshot: '2026-9', observedAt: '2026-10-21T00:00:00Z',
  });
  assert.throws(() => buildCniCatalog(source, '2026-13', [{classification: path}]), /snapshot/);
  assert.throws(() => buildCniCatalog(source, '2026-09', [{classification: path}, {classification: path.map((p, i) => i === 2 ? {...p, name: 'Conflict'} : p)}]), /Conflicting/);
});

test('catalogs reject missing parents, duplicate codes and cycles; unknown codes are not guessed', () => {
  assert.throws(() => validateCatalog({...sic, nodes: [sic.nodes[1]]}), /parent/);
  assert.throws(() => validateCatalog({...sic, nodes: [...sic.nodes, sic.nodes[0]]}), /duplicate/);
  assert.throws(() => validateCatalog({...sic, nodes: [{...sic.nodes[0], parentCode: '0111'}, sic.nodes[1]]}), /cycle/);
  assert.throws(() => classificationPath(sic, '9999'), /Unknown/);
});

test('mapping validates many-to-many links, evidence and exact catalog versions', () => {
  const file: IndustryMappingFile = {version: 'test', sicCatalogVersion: sic.version, cniCatalogVersion: cni().version, mappings: [
    ['01', '01'], ['01', '0101'], ['0111', '0101'],
  ].map(([sicCode, cniCode]) => ({sicCode, cniCode, relation: 'overlap', evidenceUrls: [source], reviewedAt: '2026-10-21T00:00:00Z'}))};
  assert.equal(validateMappings(file, sic, cni()).mappings.length, 3);
  assert.throws(() => validateMappings({...file, sicCatalogVersion: 'wrong'}, sic, cni()), /version/);
  assert.throws(() => validateMappings({...file, mappings: [...file.mappings, file.mappings[0]]}, sic, cni()), /Duplicate/);
  assert.throws(() => validateMappings({...file, mappings: [{...file.mappings[0], evidenceUrls: []}]}, sic, cni()), /Invalid/);
});

test('shared SEC sync updates identity and SIC together without observation-only writes', () => {
  const cik = '0000000001', entry = {code: '3674', name: 'Semiconductors'}, at = '2026-10-21T00:00:00Z';
  const patch = secCompanySyncPatch({}, cik, entry, 'catalog', at)!;
  assert.equal(patch.cik, cik);
  assert.equal(patch.taxonomy, 'SIC');
  assert.equal(secCompanySyncPatch(patch, cik, entry, 'new-catalog', at), null);
  assert.deepEqual(secCompanySyncPatch({classification: [entry]}, cik, null, '', at), {cik});
  assert.deepEqual(secCompanySyncPatch({taxonomy: 'CNI'}, cik, entry, 'catalog', at), {cik});
  assert.equal(secCompanySyncPatch({isDeleted: true}, cik, entry, 'catalog', at), null);
  assert.throws(() => secCompanySyncPatch({cik: '2'}, cik, entry, 'catalog', at), /conflict/);
  assert.deepEqual(secCompanySyncPatch({cik: 1}, cik, null, '', at), {cik});
});

test('scheduled SEC sync reuses snapshots, detects conflicts and writes only changed companies', async () => {
  const {createSecCompanySync} = await import('../../src/lib/industry-classification/sec-sync');
  const cik = '0000000001';
  let data: Record<string, unknown> = {}, reads = 0, writes = 0;
  const db = {
    collection: () => ({doc: () => ({})}),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async () => { reads++; return {exists: true, data: () => data}; },
      update: (_ref: unknown, patch: Record<string, unknown>) => { writes++; data = {...data, ...patch}; },
    }),
  };
  const sync = createSecCompanySync(db as never, new Map([['US:TEST', {}]]));
  assert.equal(sync.register('US:TEST', cik), cik);
  await sync.observe(cik, {cik: 1, sic: ''});
  await sync.observe(cik, {cik: 1, sic: ''});
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(data.cik, cik);
  assert.equal(sync.register('US:TEST'), cik);
  assert.throws(() => sync.register('US:TEST', '0000000002'), /conflict/);
  const deleted = createSecCompanySync(db as never, new Map([['US:TEST', {}]]));
  deleted.register('US:TEST', cik); data = {isDeleted: true};
  await deleted.observe(cik, {cik: 1, sic: ''});
  assert.equal(writes, 1);
});
