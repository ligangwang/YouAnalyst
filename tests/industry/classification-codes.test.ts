import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assignedClassificationCodes,companyClassificationPaths,industryPath,taxonomyCatalog} from '../../src/lib/industry-classification/catalog';
import {secClassificationPatch} from '../../src/lib/industry-classification/sec';
import {publicChinaCompany} from '../../src/lib/industry-research/china-directory';
import {classificationCodesPatch} from '../../src/lib/industry-classification/migration';

test('static catalogs have complete bilingual names and valid paths',()=>{
  for(const taxonomy of ['SIC','CNI'] as const) for(const node of taxonomyCatalog(taxonomy).nodes) {
    assert.ok(node.translations.en);assert.match(node.translations['zh-CN']!,/[\u3400-\u9fff]/);
    assert.equal(industryPath(taxonomy,node.code).at(-1)?.code,node.code);
  }
  assert.deepEqual(industryPath('SIC','3674').map(n=>n.code),['D','36','367','3674']);
  assert.equal(industryPath('SIC','3674','zh-CN').at(-1)?.name,'半导体及相关器件');
  assert.deepEqual(industryPath('CNI','C08030101').map(n=>n.code),['C08','C0803','C080301','C08030101']);
  assert.equal(industryPath('CNI','C08030101').at(-1)?.name,'Integrated Circuits');
  assert.equal(industryPath('SIC','8888').length,1);
});
test('migration accepts both formats, validates ancestors and preserves code identity',()=>{
  assert.deepEqual(assignedClassificationCodes('SIC',[{code:'0100',name:'old label'}]),['0100']);
  const old=industryPath('CNI','C08030101','zh-CN');
  assert.deepEqual(assignedClassificationCodes('CNI',old),['C08030101']);
  assert.deepEqual(assignedClassificationCodes('CNI',['C08030101']),['C08030101']);
  assert.throws(()=>assignedClassificationCodes('CNI',[old[0],{code:'C01',name:'wrong'},old[3]]),/Invalid/);
  assert.throws(()=>assignedClassificationCodes('SIC',['not-known']),/Unknown/);
  assert.deepEqual(companyClassificationPaths({taxonomy:'CNI',classification:old}),companyClassificationPaths({taxonomy:'CNI',classification:['C08030101']}));
});
test('SEC code-only assignments do not change when provider names change',()=>{
  const first=secClassificationPatch({}, {code:'3674',name:'Semiconductors'},'0000000001','v','2026-10-21T00:00:00Z')!;
  assert.deepEqual(first.classification,['3674']);
  assert.equal(secClassificationPatch(first,{code:'3674',name:'New display name'},'0000000001','v2','2026-10-22T00:00:00Z'),null);
});
test('China public profiles resolve the same stage and description for both formats',()=>{
  const data={market:'CN_A',status:'DIRECTORY',name:'测试公司',taxonomy:'CNI',source:'https://www.cnindex.com.cn/',sourceLabel:'CNI'};
  const legacy=publicChinaCompany('XSHG:600000',{...data,classification:industryPath('CNI','C08030101','zh-CN')});
  const migrated=publicChinaCompany('XSHG:600000',{...data,classification:['C08030101']});
  assert.deepEqual(migrated,legacy);assert.ok(migrated);
});
test('migration preserves provenance, skips tombstones and is idempotent',()=>{
  const source={taxonomy:'CNI',classification:industryPath('CNI','C08030101'),classificationMetadata:{sourceUrl:'https://www.cnindex.com.cn/',sourceSnapshot:'2026-09',observedAt:'2026-10-21T00:00:00Z',catalogVersion:'old'}};
  const patch=classificationCodesPatch(source)!;
  assert.deepEqual(patch.classification,['C08030101']);
  assert.deepEqual(patch.classificationMetadata,{...source.classificationMetadata,catalogVersion:taxonomyCatalog('CNI').version});
  assert.equal(classificationCodesPatch({...source,...patch}),null);
  assert.equal(classificationCodesPatch({...source,isDeleted:true}),null);
  assert.equal(classificationCodesPatch({name:'No assignment'}),null);
});
