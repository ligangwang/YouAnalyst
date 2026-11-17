import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { CONTROL } from './repository';
import { MARKET_COLLECTIONS } from './policy';
import { MARKET_ROOT, calendarIndexFile, type MarketHead } from './files';
import {marketIndexFormat} from './index-fields';
import {announcementIndexFile} from './announcement-sidecar';
/** Retire only old immutable generations. Current heads, source backups and
 * content-addressed captures remain protected. The grace period exceeds any
 * serving query or transaction lifetime, including the local file cache. */
export async function collectMarketGarbage(raw: Firestore, bucket: Bucket, now = Date.now()) {
    if ((await raw.doc(CONTROL).get()).get('ready') !== true)
        return { deleted: 0, skipped: 'bootstrap' };
    const active = new Set<string>();
    for (const collection of MARKET_COLLECTIONS) {
        const docs = await raw.collection('collectors').where('marketCollection', '==', collection).get();
        for (const doc of docs.docs) {
            const head = doc.get('marketHead') as MarketHead;
            if (head.file)
                active.add(head.file);
            if (head.indexFile)
                active.add(head.indexFile);
            if (head.prefixFile){
                active.add(head.prefixFile);
                if(collection==='events'&&marketIndexFormat(head.format)>=11)active.add(calendarIndexFile(head.prefixFile));
                if(collection==='events'&&marketIndexFormat(head.format)>=12)
                    for(let bucket=0;bucket<16;bucket++)active.add(announcementIndexFile(head.prefixFile,bucket));
            }
        }
    }
    let deleted = 0;
    for await (const file of bucket.getFilesStream({ prefix: MARKET_ROOT + '/data/' })) {
        const created = Date.parse(String(file.metadata.timeCreated ?? ''));
        if (active.has(file.name) || !Number.isFinite(created) || now - created < 7 * 86400000)
            continue;
        await file.delete({ ifGenerationMatch: file.metadata.generation });
        deleted++;
    }
    return { deleted };
}
