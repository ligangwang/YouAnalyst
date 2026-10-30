/** Explicit recovery mode refreshes files without launching instrument writes. */
export function snapshotSyncOptions(args:string[]){
  if(args.some(arg=>arg!=='--snapshots-only'))throw Error('Usage: sync-entity-snapshots [--snapshots-only]');
  return {dispatchInstruments:!args.includes('--snapshots-only')};
}
