import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

test("paused filing pages and APIs are unavailable in either language, without blocking research", () => {
  for (const path of ["/institutions", "/institutions/0001067983", "/daily/insiders", "/daily/insider/2026-09-17/purchase/AMD", "/daily/institutional/2026-09-17"]) {
    for (const prefix of ["", "/en", "/zh-cn"]) {
      const response = proxy(new NextRequest(`https://youanalyst.com${prefix}${path}`));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("x-robots-tag"), "noindex");
    }
  }
  for (const path of ["/api/institutional-holdings/AMD", "/api/insider-transactions/AMD", "/api/institutions/discovery"]) {
    assert.equal(proxy(new NextRequest(`https://youanalyst.com${path}`)).status, 404);
  }
  for (const path of ["/en", "/en/ticker/AMD", "/en/daily/calls", "/en/feed", "/api/knowledge-graph", "/api/company-updates"]) {
    assert.notEqual(proxy(new NextRequest(`https://youanalyst.com${path}`)).status, 404);
  }
});
