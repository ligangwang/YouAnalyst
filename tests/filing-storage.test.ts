import test from "node:test";
import assert from "node:assert/strict";
import { filingRelationship, filingRelationshipId } from "../src/lib/company-graph/market-storage";
import { graphFromMarket } from "../src/lib/knowledge-graph/market-store";
import type { CompanyGraphEdge } from "../src/lib/company-graph/types";
test("filing observations retain original direction and evidence without asserting an unresolved company identity",()=>{
  const edge={id:"AMD_20260001_example",sourceTicker:"AMD",sourceCik:"0000002488",sourceName:"AMD",targetName:"manufacturing partners",targetType:"category",relationshipType:"CUSTOMER_OF",direction:"target_to_source",evidenceText:"We rely on manufacturing partners.",filingType:"10-K",accessionNumber:"0000002488-26-000001",filingDate:"2026-02-01"} as CompanyGraphEdge;
  const migrated=filingRelationship(edge,"https://www.sec.gov/Archives/edgar/data/2488/report.htm");
  for(const [key,value]of Object.entries(edge))assert.deepEqual(migrated[key as keyof typeof migrated],value);
  assert.equal(migrated.status,"NEEDS_REVIEW");
  assert.equal(migrated.recordKind,"FILING_OBSERVATION");
  assert.equal(migrated.evidence[0].summary,edge.evidenceText);
  assert.equal(migrated.evidence[0].url,"https://www.sec.gov/Archives/edgar/data/2488/report.htm");
  assert.equal(filingRelationshipId(edge.id),"filing:"+edge.id);
  assert.equal(graphFromMarket([],[]).relationships.length,0);
});
test("fallback evidence points to the original SEC filing index",()=>{
  const edge={id:"edge",sourceTicker:"AMD",sourceCik:"0000002488",sourceName:"AMD",accessionNumber:"0000002488-26-000001",filingType:"10-K",filingDate:"2026-02-01",evidenceText:"quote"} as CompanyGraphEdge;
  assert.equal(filingRelationship(edge).filingUrl,"https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/0000002488-26-000001-index.html");
});
