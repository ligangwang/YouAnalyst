import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
import {Storage} from '@google-cloud/storage';
import {MarketFiles, type MarketHead} from '../../src/lib/market-store/files';
import {verifyExchangeRegion} from './verify-exchange-region.mjs';

async function main() {
    const project = process.env.GCP_PROJECT_ID;
    assert(project, 'GCP_PROJECT_ID required');
    const db = new Firestore({projectId: project});
    try {
        const catalog = await db.collection('collectors').where('marketCollection', '==', 'companies').get();
        const heads = catalog.docs.map(doc => doc.get('marketHead') as MarketHead);
        if (!heads.some(head => head.companyStorage)) {
            const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? execFileSync('gcloud', ['auth','print-access-token'], {encoding:'utf8'}).trim();
            return await verifyExchangeRegion({project, token});
        }
        assert(heads.length === 256 && heads.every(head => head.companyStorage === 'parquet' && !head.retained.length), 'Incomplete Parquet company catalog');
        const bucket = process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
        assert(bucket, 'Company Parquet bucket required');
        const files = new MarketFiles(new Storage({projectId: project}).bucket(bucket));
        try {
            const theme = {method:'where', args:['themeIds','array-contains-any',['ai','robotics','space']]};
            const projection = {method:'select', args:['exchange_region']};
            const all = await files.query(heads, [theme,projection]);
            const selected = await files.query(heads, [theme,{method:'where',args:['exchange_region','==','US']},projection]);
            const expected = all.map(row => row.id).filter(id => /^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(id)).sort();
            assert(expected.length > 0, 'Parquet US company scope unexpectedly empty');
            assert.deepEqual(selected.map(row => row.id).sort(), expected);
            return {event:'exchange_region_release_verified',themeCompanies:all.length,usCompanies:selected.length};
        } finally { await files.close(); }
    } finally { await db.terminate(); }
}
main().then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message);process.exitCode=1;});
