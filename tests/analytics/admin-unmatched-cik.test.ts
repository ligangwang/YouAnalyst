import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

test('unmatched CIK admin endpoint enforces authorization and pages before filtering', async () => {
  const state = { user: null as { uid: string } | null, admin: false, reads: 0, after: '' };
  const docs = Array.from({ length: 101 }, (_, i) => ({ id: `US:A${String(i).padStart(3, '0')}`,
    data: () => ({ name: `Company ${i}`, ...(i === 0 ? {} : { cik: i === 1 ? '0000000000' : i === 2 ? 'bad' : '123' }) }) }));
  const query = { select: () => query, where: () => query, orderBy: () => query,
    startAfter: (id: string) => { state.after = id; return query; },
    limit: (size: number) => { assert.equal(size, 101); return query; },
    get: async () => { state.reads++; return { docs }; }, doc: (id: string) => ({ id }) };
  const db = { collection: () => query, getAll: async () => [{ data: () => undefined }] };
  const bundle = await build({ entryPoints: ['src/app/api/admin/unmatched-cik/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'admin-fixture', setup(builder) {
    builder.onLoad({ filter: /[\\/]firebase[\\/]auth\.ts$/ }, () => ({ contents: 'export const getDecodedUserFromRequest=async()=>state.user;', loader: 'js' }));
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin-role\.ts$/ }, () => ({ contents: 'export const isAdminUser=async()=>state.admin;', loader: 'js' }));
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: 'export const getAdminFirestore=()=>db;', loader: 'js' }));
  } }] });
  const testModule = { exports: {} as { GET: (request: { nextUrl: URL }) => Promise<Response> } };
  new Function('state', 'db', 'require', 'module', bundle.outputFiles[0].text)(state, db, createRequire(import.meta.url), testModule);
  const request = (after = '') => testModule.exports.GET({ nextUrl: new URL('https://example.com/api/admin/unmatched-cik?' + new URLSearchParams({ after })) });
  assert.equal((await request()).status, 401);
  state.user = { uid: 'reader' };
  assert.equal((await request()).status, 403);
  assert.equal(state.reads, 0);
  state.admin = true;
  assert.equal((await request('../invalid')).status, 400);
  const response = await request();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json();
  assert.deepEqual(body.items.map((row: { id: string }) => row.id), ['US:A000', 'US:A001', 'US:A002']);
  assert.equal(body.scanned, 100);
  assert.equal(body.nextCursor, 'US:A099');
  await request(body.nextCursor);
  assert.equal(state.after, 'US:A099');
});
