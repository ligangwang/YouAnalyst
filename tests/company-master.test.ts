import test from "node:test";
import assert from "node:assert/strict";
import {companyFields} from "../src/lib/market-companies/model";

test("company identities stay market-qualified and search supports Chinese names and codes", () => {
  const cn=companyFields("XSHG:688041",{name:"海光信息"});
  assert.equal(cn.symbol,"688041");
  assert.equal(cn.market,"CN_A");
  for(const q of ["海光","光信","688041","xshg:688041"]) assert(cn.searchPrefixes.includes(q));
  const us=companyFields("US:AMD",{name:"Advanced Micro Devices",symbol:"AMD"});
  for(const q of ["amd","micro","advanced micro"]) assert(us.searchPrefixes.includes(q));
  assert.equal(us.id,"US:AMD");
  assert.equal(us.market,"US");
  assert.equal(new Set(us.searchPrefixes).size,us.searchPrefixes.length);
});
