import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillRelationshipSources} from '../scripts/backfill-relationship-sources';
import {encode,type Value} from '../scripts/migrate-company-themes';

test('source backfill deduplicates paid translations and preserves raw Firestore provenance behind revision guards',async()=>{
 const title='Documented partnership';
 const source={mapValue:{fields:{id:encode('evidence'),title:encode(title),url:encode('https://example.com'),checkedAt:{timestampValue:'2026-10-08T00:00:00Z'},titleTranslations:encode({en:{source:title,text:title}})}}} satisfies Value;
 const document={name:'projects/test-project/databases/(default)/documents/company_relationships/edge',updateTime:'2026-10-08T00:00:00Z',fields:{evidence:{arrayValue:{values:[source,source]}},status:encode('PUBLISHED')}};
 const commits:{writes:Record<string,unknown>[]}[]=[];let calls=0;
 const request=async(url:string,data:unknown)=>{
  if(url.endsWith(':commit')){commits.push(data as typeof commits[number]);return {};}
  const collection=(data as {structuredQuery:{from:{collectionId:string}[]}}).structuredQuery.from[0].collectionId;
  return collection==='company_relationships'?[{document}]:[];
 };
 const translate=async(items:{id:string;title:string}[])=>{calls++;assert.equal(items.length,1);return {translations:[{id:'0',text:'已记录的合作关系'}],model:'gpt-6-luna',responseId:'test-response',usage:null};};
 const dependencies={request,translate};
 const preview=await backfillRelationshipSources('test-project','token','key',false,dependencies);
 assert.equal(preview.pending,2);assert.equal(calls,0);assert.equal(commits.length,0);
 const result=await backfillRelationshipSources('test-project','token','key',true,dependencies);
 assert.equal(result.stored,2);assert.equal(calls,1);
 const write=commits.at(-1)!.writes[0] as {update:{fields:Record<string,Value>};updateMask:{fieldPaths:string[]};currentDocument:{updateTime:string}};
 assert.deepEqual(write.updateMask.fieldPaths,['evidence']);assert.equal(write.currentDocument.updateTime,document.updateTime);
 for(const value of write.update.fields.evidence.arrayValue!.values!){
  const fields=value.mapValue!.fields!;
  assert.deepEqual(fields.checkedAt,source.mapValue.fields.checkedAt);
  assert.deepEqual(fields.url,source.mapValue.fields.url);
  assert.deepEqual(fields.titleTranslations.mapValue!.fields!.en,source.mapValue.fields.titleTranslations.mapValue!.fields!.en);
  assert.equal(fields.titleTranslations.mapValue!.fields!['zh-CN'].mapValue!.fields!.text.stringValue,'已记录的合作关系');
 }
});
