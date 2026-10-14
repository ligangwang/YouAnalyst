import { GoogleAuth } from 'google-auth-library';
import { pinyinSearchFields, PINYIN_SEARCH_VERSION } from '../src/lib/market-companies/pinyin-search';

type Value = { stringValue?: string; integerValue?: string; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> } };
function decode(value?: Value): unknown {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.integerValue !== undefined) return Number(value.integerValue);
  if (value?.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value?.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
  return undefined;
}
// Existing company records only; no provider requests or new collections.
async function main() {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId) || !process.argv.some(arg => arg === '--preview' || arg === '--apply')) throw new Error('Set GCP_PROJECT_ID and use --preview or --apply');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? await auth.getAccessToken();
  if (!token) throw new Error('Existing Google credentials required');
  const database = `projects/${projectId}/databases/(default)`, apply = process.argv.includes('--apply');
  const request = async (operation: string, body: unknown) => {
    const response = await fetch(`https://firestore.googleapis.com/v1/${database}/documents:${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Firestore ${operation} returned HTTP ${response.status}`);
    return response.json();
  };
  let after: string | undefined, scanned = 0, changed = 0;
  for (;;) {
    const page = await request('runQuery', { structuredQuery: {
      select: { fields: ['name', 'legalName', 'names', 'aliases', 'pinyinSearchVersion', 'pinyinSearchTerms'].map(fieldPath => ({ fieldPath })) },
      from: [{ collectionId: 'companies' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 200,
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
    } }) as { document?: { name: string; fields: Record<string, Value>; updateTime: string } }[];
    const docs = page.flatMap(row => row.document ? [row.document] : []);
    if (!docs.length) break;
    const writes: unknown[] = [];
    for (const doc of docs) {
      scanned++; const data = Object.fromEntries(Object.entries(doc.fields).map(([key, value]) => [key, decode(value)]));
      const fields = pinyinSearchFields(data);
      if (!fields.pinyinSearchTerms.length && data.pinyinSearchVersion === undefined) continue;
      if (data.pinyinSearchVersion === PINYIN_SEARCH_VERSION && JSON.stringify(data.pinyinSearchTerms) === JSON.stringify(fields.pinyinSearchTerms)) continue;
      changed++;
      if (apply) {
        writes.push({ update: { name: doc.name, fields: {
          pinyinSearchTerms: { arrayValue: { values: fields.pinyinSearchTerms.map(stringValue => ({ stringValue })) } },
          pinyinSearchPrefixes: { arrayValue: { values: fields.pinyinSearchPrefixes.map(stringValue => ({ stringValue })) } },
          pinyinSearchVersion: { integerValue: String(fields.pinyinSearchVersion) },
        } }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: doc.updateTime } });
        if (writes.length === 25) { await request('commit', { writes }); writes.length = 0; }
      }
    }
    if (writes.length) await request('commit', { writes });
    after = docs.at(-1)!.name;
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', scanned, changed }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Pinyin indexing failed'); process.exitCode = 1; });
