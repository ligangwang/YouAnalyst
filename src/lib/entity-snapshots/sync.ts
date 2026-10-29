import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
export const collections = ['companies', 'instruments', 'company_fundamentals', 'company_relationships', 'eod_prices'] as const;
export type Collection = typeof collections[number];
export type Row = { id: string; data: DocumentData };
export type Snapshot = { version: 1; collection: Collection; watermark: Timestamp; rows: Row[] };
export interface Source {
  boundary(): Promise<Timestamp>;
  pages?(collection: Collection, since: Timestamp | undefined, through: Timestamp): AsyncIterable<Row[]>;
  rows(collection: Collection, since: Timestamp | undefined, through: Timestamp): Promise<Row[]>;
}
export interface Files {
  load(collection: Collection): Promise<{ snapshot?: Snapshot; generation: string }>;
  save(collection: Collection, snapshot: Snapshot, generation: string): Promise<void>;
}

/** Each complete file and its watermark are published in one conditional write.
 * A failed/overlapping run never advances a watermark or erases a newer file. */
export async function syncCollection(collection: Collection, source: Source, files: Files) {
  const previous = await files.load(collection);
  const through = await source.boundary();
  if(previous.snapshot && previous.snapshot.watermark.toMillis()>through.toMillis())throw Error('Snapshot watermark is in the future');
  const changes = await source.rows(collection, previous.snapshot?.watermark, through);
  const rows = new Map(previous.snapshot?.rows.map(row => [row.id, row]) ?? []);
  for(const row of changes) {
    if(!(row.data.updatedAt instanceof Timestamp))throw Error(`Timestamp migration required: ${collection}/${row.id}`);
    if(row.data.isDeleted===true)rows.delete(row.id);
    else rows.set(row.id, row);
  }
  const snapshot: Snapshot = {version:1, collection, watermark:through, rows:[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  await files.save(collection, snapshot, previous.generation);
  return {collection, initial:!previous.snapshot, changed:changes.length, deleted:changes.filter(row=>row.data.isDeleted===true).length, records:rows.size, watermark:through.toDate().toISOString()};
}
