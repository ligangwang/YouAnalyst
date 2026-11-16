import {createHash,randomUUID} from 'node:crypto';
import {FieldPath,type DocumentSnapshot} from 'firebase-admin/firestore';
import {encode} from '../central-cache/codec';
import {fieldName} from './value';
import type {Step} from './query';
const processRunId=randomUUID();
/** Hash values and projections, not just the redacted query shape. */
export function nativeReadFingerprint(steps:Step[]):string {
    const normalized=steps.map(step=>({method:step.method,args:step.args.map(value=>
        value instanceof FieldPath?{field:fieldName(value)}:
        value&&typeof value==='object'&&'ref' in value?{cursor:(value as DocumentSnapshot).ref.path,version:encode((value as DocumentSnapshot).updateTime)}:encode(value))}));
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
/** Large native reads bypass the outer adapter observer. No extra reads or values in logs. */
export function reportNativeRead(collection:string,steps:Step[],documents:number,transaction:boolean):void {
    if(documents<100)return;
    try {
        console.info(JSON.stringify({severity:'INFO',event:'market_native_read',collection,
            documentsReturned:documents,queryParametersFingerprint:nativeReadFingerprint(steps),
            transaction,processRunId,revision:process.env.K_REVISION??null,
            job:process.env.K_SERVICE??process.env.CLOUD_RUN_JOB??null,
            timestamp:new Date().toISOString()}));
    } catch { /* Diagnostics must not change successful read behavior. */ }
}
