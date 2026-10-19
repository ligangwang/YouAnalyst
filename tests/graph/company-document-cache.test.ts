import test from 'node:test';
import assert from 'node:assert/strict';
import {marketCapChanged} from '../../src/lib/company-change-index';
test('protobuf update masks distinguish market-cap changes, creations and deletions',()=>{
  const field=(tag:number,bytes:Uint8Array)=>Buffer.from([tag,bytes.length,...bytes]);
  const event=(path:string)=>Buffer.concat([field(10,Buffer.from('')),field(18,Buffer.from('')),field(26,field(10,Buffer.from(path)))]);
  assert.equal(marketCapChanged(event('checkedAt'),'application/protobuf'),false);
  assert.equal(marketCapChanged(event('marketCap.value'),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([18,0]),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([10,0]),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([26,255]),'application/protobuf'),true);
});
