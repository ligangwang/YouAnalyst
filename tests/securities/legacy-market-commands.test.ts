import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
for(const name of ['backfill-news-headlines','backfill-relationship-sources','backfill-relationship-summaries','enroll-theme-companies','migrate-company-onboarding','monitor-onboarding-capacity','publish-news-sources']){
    test(`${name} refuses legacy REST work before credentials or requests`,()=>{
        const result=spawnSync(process.execPath,['--import','tsx',`scripts/${name}.ts`],{encoding:'utf8',timeout:30000,windowsHide:true,
            env:{...process.env,GCP_PROJECT_ID:'not-a-real-project',GOOGLE_APPLICATION_CREDENTIALS:'unavailable-test-credentials.json',GOOGLE_OAUTH_ACCESS_TOKEN:'invalid-test-token'}});
        assert.equal(result.status,1);assert.match(result.stderr,/Legacy direct-Firestore market maintenance is retired/);
    });
}
test('EOD repair uses the shared client instead of a private REST implementation',()=>{
    const source=readFileSync('scripts/repair-eod-run.ts','utf8');
    assert.match(source,/from '\.\.\/src\/lib\/firebase\/firestore'/);
    assert.doesNotMatch(source,/restFirestore|firestore\.googleapis\.com/);
});
