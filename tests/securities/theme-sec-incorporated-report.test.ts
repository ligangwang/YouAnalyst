import test from 'node:test';
import assert from 'node:assert/strict';
import {secIncorporatedAnnual} from '../../src/lib/company-themes/sec-incorporated-report';

const annual={documentId:'0000051143-26-000010',filedAt:'2026-02-01',url:'https://www.sec.gov/Archives/edgar/data/51143/000005114326000010/report.htm',laterDisclosures:false};
const header='ACCESSION NUMBER: 0000051143-26-000010\nCENTRAL INDEX KEY: 0000051143\n';
const document='<DOCUMENT>\n<TYPE>EX-13\n<FILENAME>annual.htm\n<TEXT><html><body>'+('Business segments. '.repeat(100))+'</body></html></TEXT>\n</DOCUMENT>';
const full=(value:string)=>header+value+'\n</SEC-DOCUMENT>';
test('resolves a single incorporated annual report from the exact issuer submission',()=>{
  const result=secIncorporatedAnnual(full(document),'51143',annual);
  assert.equal(result?.url,'https://www.sec.gov/Archives/edgar/data/51143/000005114326000010/annual.htm');
  assert.match(result!.text,/Business segments/);
  assert.equal(secIncorporatedAnnual(full(document),'51144',annual),null);
  assert.equal(secIncorporatedAnnual(full(document+document),'51143',annual),null);
  assert.equal(secIncorporatedAnnual(full(document.replace('annual.htm','../annual.htm')),'51143',annual),null);
  assert.equal(secIncorporatedAnnual(full(document.replace('</TEXT>','')),'51143',annual),null);
  assert.equal(secIncorporatedAnnual(header+document,'51143',annual),null);
});
