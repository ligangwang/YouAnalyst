import { createHash } from 'node:crypto';

export type IndexedCollection = 'companies' | 'company_fundamentals' | 'company_relationships';
export type CompanyChange = { id: string; version: string; marketCap?: string };
export type CompanyIndex = { version: string; generation: string; shards: Record<string, string> };
export function companyChangeKey(id: string) { return createHash('sha256').update(id).digest('hex'); }
export function companyChangeShard(id: string) { return String(parseInt(companyChangeKey(id).slice(0, 2), 16) % 64); }
export function companyChangeDocument(collection: IndexedCollection, shard: string) { return `_company_changes_v1_${collection}_${shard}`; }

/** Decode only the length-delimited fields needed from Firestore DocumentEventData.
 * Unknown/malformed payloads invalidate conservatively, never hide a change.
 */
export function marketCapChanged(body?: Uint8Array, contentType = ''): boolean {
  if (!body?.length) return true;
  try {
    let paths: string[];
    if (contentType.includes('json')) {
      const event = JSON.parse(Buffer.from(body).toString('utf8'));
      if (!event.value || !event.oldValue || !Array.isArray(event.updateMask?.fieldPaths)) return true;
      paths = event.updateMask.fieldPaths;
    } else if (contentType.includes('protobuf')) {
      const fields = (bytes: Uint8Array) => {
        let offset = 0;
        const result = new Map<number, Uint8Array[]>();
        const integer = () => { let n = 0, shift = 0; for (;;) { if (offset >= bytes.length || shift > 49) throw Error('Invalid protobuf'); const b = bytes[offset++]; n += (b & 127) * 2 ** shift; if (!(b & 128)) return n; shift += 7; } };
        while (offset < bytes.length) {
          const tag = integer(), wire = tag % 8, field = Math.floor(tag / 8);
          if (wire === 2) { const size = integer(); if (offset + size > bytes.length) throw Error('Truncated protobuf'); result.set(field, [...(result.get(field) ?? []), bytes.slice(offset, offset + size)]); offset += size; }
          else if (wire === 0) integer();
          else if (wire === 1 || wire === 5) { offset += wire === 1 ? 8 : 4; if(offset > bytes.length)throw Error('Truncated protobuf'); }
          else throw Error('Unsupported protobuf');
        }
        return result;
      };
      const event = fields(body);
      if (!event.has(1) || !event.has(2) || !event.has(3)) return true;
      paths = (fields(event.get(3)![0]).get(1) ?? []).map(value => Buffer.from(value).toString('utf8'));
    } else return true;
    return !paths.length || paths.some(path => path === 'marketCap' || path.startsWith('marketCap.') || path.startsWith('`marketCap`'));
  } catch { return true; }
}
