import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {publishDirectoryRequest} from '../../src/lib/industry-research/directory-pubsub';
import {processDirectoryCompanyMessage,type DirectoryMessage} from '../../src/lib/industry-research/directory-company-queue';
import {industryPath} from '../../src/lib/industry-classification/catalog';

test('directory company tasks freeze the snapshot, preserve profiles and gate publication on every receipt',async()=>{
  const f=pubsubFirestore();
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const messages:DirectoryMessage[]=[],publish=async(message:DirectoryMessage)=>{messages.push(message);};
  const payload={source:'https://www.cnindex.com.cn/zh_information/data_resource/fljg/test',snapshot:'2026-09',sha256:'a'.repeat(64),
    companies:Array.from({length:4000},(_,i)=>({id:`XSHG:${600000+i}`,name:`Company ${i}`,classification:industryPath('CNI','C08030101','zh-CN')}))};
  f.rows.set('companies/XSHG:600000',{description:'preserve me'});
  let downloads=0;
  const deliver=(message:DirectoryMessage)=>processDirectoryCompanyMessage(message,f.db,f.log,publish,async()=>{downloads++;return payload;});
  await publishDirectoryRequest(f.db,'execution-queue',publish);
  await deliver(messages.shift()!);
  const root=messages[0];
  assert.equal(root.type,'directory.company-run.requested');
  await deliver(messages.shift()!);
  const withheld=messages.find(message=>message.type==='company.work.requested')!;
  messages.splice(messages.indexOf(withheld),1);
  for(let i=0;messages.length;i++){assert.ok(i<5000);await deliver(messages.shift()!);}
  assert.equal(downloads,1);
  assert.equal(f.rows.get('directory_syncs/CN_A_CNI')?.sha256,undefined,'one unfinished company blocks directory publication');
  await deliver(withheld);await deliver(withheld);
  while(messages.length)await deliver(messages.shift()!);
  assert.equal(f.rows.get('directory_syncs/CN_A_CNI')?.sha256,payload.sha256);
  assert.equal(f.rows.get('directory_syncs/CN_A_CNI')?.count,4000);
  assert.equal(f.rows.get('companies/XSHG:600000')?.description,'preserve me');
  assert.equal(f.writes.filter(path=>path==='company_directory/XSHG:600000').length,1);
  const writes=f.writes.filter(path=>path.startsWith('companies/')).length;
  await publishDirectoryRequest(f.db,'next-execution',publish);
  while(messages.length)await deliver(messages.shift()!);
  assert.equal(f.writes.filter(path=>path.startsWith('companies/')).length,writes,'unchanged snapshots do not rewrite profiles');
});
