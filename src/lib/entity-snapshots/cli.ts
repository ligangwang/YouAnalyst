/** Explicit recovery mode refreshes files without launching instrument writes. */
export function snapshotSyncOptions(args:string[]){
  if(args.some(arg=>!['--snapshots-only','--entities-only'].includes(arg)))throw Error('Usage: sync-entity-snapshots [--snapshots-only] [--entities-only]');
  return {dispatchInstruments:!args.includes('--snapshots-only'),includePrices:!args.includes('--entities-only')};
}
