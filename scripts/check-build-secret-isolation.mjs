import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=readFileSync('cloudbuild.yaml','utf8');
const deploy=readFileSync('scripts/deploy-cloud-run.sh','utf8');
for (const name of ['TWELVE_DATA_API_KEY','EODHD_API_TOKEN','INTERNAL_API_TOKEN','OPENAI_API_KEY']) {
 assert(!config.includes(name), `${name} must not enter Cloud Build config`);
 assert(!deploy.includes('${'+name), `${name} must not enter Cloud Build substitutions`);
}
assert(config.includes('--update-env-vars'));
assert(config.includes('--no-traffic'));
assert(!config.includes('--set-env-vars'));
assert(deploy.indexOf('check-runtime-credentials.mjs')<deploy.indexOf('gcloud builds submit'));
console.log('Build secret isolation and no-traffic deployment checks passed');
