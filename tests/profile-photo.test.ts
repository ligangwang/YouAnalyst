import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { MAX_PHOTO_BYTES, normalizePhoto, resolveProfilePhoto } from "../src/lib/users/photo";
import { POST as changePhoto } from "../src/app/api/users/[id]/photo/route";

test("uploads become square WebP images with metadata removed", async () => {
  const original = await sharp({ create: { width: 640, height: 320, channels: 3, background: "red" } }).jpeg().toBuffer();
  const metadata = await sharp(await normalizePhoto(original)).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
});

test("rejects malformed, oversized, and SVG uploads", async () => {
  await assert.rejects(normalizePhoto(Buffer.from("not an image")));
  await assert.rejects(normalizePhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1)));
  await assert.rejects(normalizePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')));
});

test("Google updates preserve custom photos until explicitly reset", () => {
  assert.equal(resolveProfilePhoto({photoSource:"custom", photoURL:"/custom"}, "https://google/new"), "/custom");
  assert.equal(resolveProfilePhoto({photoSource:"google", photoURL:"https://google/old"}, "https://google/new"), "https://google/new");
  assert.equal(resolveProfilePhoto({photoURL:"https://google/old"}, "https://google/new"), "https://google/new");
  assert.equal(resolveProfilePhoto({photoSource:"google"}, null), null);
});
test("photo changes require authentication", async () => {
  const request = new NextRequest("http://localhost/api/users/owner/photo", {method:"POST", body:"invalid"});
  assert.equal((await changePhoto(request, {params:Promise.resolve({id:"owner"})})).status, 403);
});
