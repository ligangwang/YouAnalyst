import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../../src/app/api/preferences/route";

test("preferences cannot be read or saved by supplying another user's ID without authentication", async () => {
  const read = await GET(new NextRequest("https://youanalyst.com/api/preferences?uid=another-user"));
  const write = await PATCH(new NextRequest("https://youanalyst.com/api/preferences", { method: "PATCH", body: JSON.stringify({ uid: "another-user", language: "zh-CN", market: "ALL" }) }));
  for (const response of [read, write]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
});
