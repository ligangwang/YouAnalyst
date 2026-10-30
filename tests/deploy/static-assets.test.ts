import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previousWebImages} from '../../scripts/previous-web-image.mjs';

const digest=(letter:string)=>`us-central1-docker.pkg.dev/project/web/image@sha256:${letter.repeat(64)}`;
function fixture(split=false,mutable=false){
 const row=(name:string,date:string,image:string)=>({metadata:{name,creationTimestamp:date},status:{imageDigest:image}});
 const current=row('current','2026-10-30',mutable?'web:latest':digest('a'));
 const revisions=[current,row('retained','2026-10-29',digest('b')),row('older','2026-10-28',digest('c')),row('candidate','2026-10-31',digest('d'))];
 return {service:'web',project:'project',region:'region',command:(args:string[])=>JSON.stringify(args[1]==='services'?{status:{traffic:[{revisionName:'current',percent:split?50:100},{revisionName:'retained',tag:'retain-retained'},{revisionName:'older',tag:'retain-older'},{revisionName:'candidate',tag:'candidate',...(split?{percent:50}:{})}]}}:args[2]==='list'?revisions:current)};
}
test('static retention pins current and newest retained predecessor, ignoring candidate and mutable tags',()=>{
 assert.deepEqual(previousWebImages(fixture()),{previous:digest('a'),retained:digest('b')});
 assert.throws(()=>previousWebImages(fixture(true)),/stable serving/);
 assert.throws(()=>previousWebImages(fixture(false,true)),/immutable image/);
});

test('predecessor discovery projects routing and image identity instead of full runtime records',()=>{
 const input=fixture(),calls:string[][]=[];
 assert.deepEqual(previousWebImages({...input,command:(args:string[])=>{calls.push(args);return input.command(args);}}),{previous:digest('a'),retained:digest('b')});
 assert.equal(calls[0].at(-1),'--format=json(status.traffic)');
 assert.equal(calls[1].at(-1),'--format=json(metadata.name,metadata.creationTimestamp,status.imageDigest)');
 assert.equal(calls[2].at(-1),'--format=json(metadata.name,metadata.creationTimestamp,status.imageDigest)');
});
test('both image paths preserve predecessor assets before overlaying the new release',()=>{
 for(const file of ['Dockerfile','Dockerfile.release']){
  const docker=readFileSync(file,'utf8');
  assert.match(docker,/FROM \$\{PREVIOUS_WEB_IMAGE\} AS previous-assets/);
  assert.match(docker,/FROM \$\{RETAINED_WEB_IMAGE\} AS retained-assets/);
  assert.match(docker,/FROM \$\{BOOTSTRAP_WEB_IMAGE\} AS bootstrap-assets/);
  const bootstrap=docker.lastIndexOf('COPY --from=bootstrap-assets /app/.next/static ./.next/static');
  const previous=docker.lastIndexOf('COPY --from=previous-assets /app/.next/static ./.next/static');
  const retained=docker.lastIndexOf('COPY --from=retained-assets /app/.next/static ./.next/static');
  const current=docker.lastIndexOf(file==='Dockerfile'?'COPY --from=builder /app/.next/static ./.next/static':'COPY --from=native /app ./');
  assert(bootstrap>0&&retained>bootstrap&&previous>retained&&current>previous);
 }
 const deploy=readFileSync('scripts/deploy-cloud-run.sh','utf8'),cloud=readFileSync('cloudbuild.yaml','utf8');
 assert(deploy.indexOf('node scripts/previous-web-image.mjs')<deploy.indexOf('gcloud builds submit'));
 for(const name of ['PREVIOUS_WEB_IMAGE','RETAINED_WEB_IMAGE','BOOTSTRAP_WEB_IMAGE'])assert(cloud.includes(`${name}=\${_${name}}`));
 assert.match(readFileSync('next.config.ts','utf8'),/deploymentId: process.env.GIT_SHA/);
});
