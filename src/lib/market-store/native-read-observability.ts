import {createHash,randomUUID} from 'node:crypto';
import {FieldPath,type DocumentSnapshot} from 'firebase-admin/firestore';
import {encode} from '../central-cache/codec';
import {fieldName} from './value';
import type {Step} from './query';
const processRunId=randomUUID();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Only SDK metadata is inspected; never serialize document payloads. */
export function nativeDocumentEvidence(docs:readonly DocumentSnapshot[]) {
    const rows=docs.map(doc=>[doc.ref.path,doc.exists,doc.updateTime?encode(doc.updateTime):null] as const)
        .sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    return {documentSetFingerprint:hash(rows.map(row=>row[0])),
        documentVersionsFingerprint:hash(rows),
        versionEvidenceComplete:docs.every(doc=>!doc.exists||!!doc.updateTime)};
}
/** Hash values and projections, not just the redacted query shape. */
export function nativeReadFingerprint(steps:Step[]):string {
    const normalized=steps.map(step=>({method:step.method,args:step.args.map(value=>
        value instanceof FieldPath?{field:fieldName(value)}:
        value&&typeof value==='object'&&'ref' in value?{cursor:(value as DocumentSnapshot).ref.path,version:encode((value as DocumentSnapshot).updateTime)}:encode(value))}));
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
/** Large native reads bypass the outer adapter observer. No extra reads or values in logs. */
export function reportNativeRead(collection:string,steps:Step[],documents:number,transaction:boolean,docs?:readonly DocumentSnapshot[]):void {
    if(documents<100)return;
    try {
        console.info(JSON.stringify({severity:'INFO',event:'market_native_read',collection,
            documentsReturned:documents,queryParametersFingerprint:nativeReadFingerprint(steps),
            ...(docs?nativeDocumentEvidence(docs):{}),
            transaction,processRunId,revision:process.env.K_REVISION??null,
            job:process.env.K_SERVICE??process.env.CLOUD_RUN_JOB??null,
            timestamp:new Date().toISOString()}));
    } catch { /* Diagnostics must not change successful read behavior. */ }
}

/** Count large native batches hidden by the merged Parquet result observer. */
export function reportNativeBatchRead(docs:readonly DocumentSnapshot[],transaction:boolean,fields?:string[]):void {
    if(docs.length<25)return;
    try {
        const documentsByCollection:Record<string,number>={};
        for(const doc of docs){const collection=doc.ref.path.split('/')[0];documentsByCollection[collection]=(documentsByCollection[collection]??0)+1;}
        console.info(JSON.stringify({severity:'INFO',event:'market_native_batch_read',operation:'getAll',
            documentsRequested:docs.length,documentsReturned:docs.filter(doc=>doc.exists).length,
            documentsMissing:docs.filter(doc=>!doc.exists).length,documentsByCollection,
            ...nativeDocumentEvidence(docs),projectionFingerprint:hash(fields?[...fields].sort():null),
            transaction,processRunId,revision:process.env.K_REVISION??null,
            job:process.env.K_SERVICE??process.env.CLOUD_RUN_JOB??null,timestamp:new Date().toISOString()}));
    } catch { /* Diagnostics must not change successful read behavior. */ }
}
