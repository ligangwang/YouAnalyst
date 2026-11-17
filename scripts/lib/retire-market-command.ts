/** Legacy REST entry points bypass the shared Parquet/retained-state adapter. */
export function rejectLegacyMarketCommand():void {
    throw Error('Legacy direct-Firestore market maintenance is retired. Use the Parquet-aware application or shared Firestore client.');
}
