import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { localizeMetadata } from "../../src/lib/i18n/server";

test("old company links permanently redirect with locale and query values preserved", () => {
  for (const [path, destination] of [
    ["/ticker/MSFT", "/en/company/microsoft"],
    ["/en/ticker/msft", "/en/company/microsoft"],
    ["/zh-cn/ticker/MSFT", "/zh-cn/company/microsoft"],
    ["/ticker/BRK.B", "/en/company/ticker-brk.b"],
  ]) {
    const response = proxy(new NextRequest(`https://youanalyst.com${path}?source=watchlist&tag=a&tag=b`));
    assert.equal(response.status, 308);
    const url = new URL(response.headers.get("location")!);
    assert.equal(url.pathname, destination);
    assert.equal(url.searchParams.get("source"), "watchlist");
    assert.deepEqual(url.searchParams.getAll("tag"), ["a", "b"]);
  }
});

test("company metadata uses the same canonical path for both language alternatives", () => {
  const result = localizeMetadata({ alternates: { canonical: "/company/microsoft" } }, "en", "/ticker/MSFT", { usePageCanonical: true });
  assert.equal(result.alternates?.canonical, "/en/company/microsoft");
  assert.equal(result.alternates?.languages?.["zh-CN"], "/zh-cn/company/microsoft");
});
