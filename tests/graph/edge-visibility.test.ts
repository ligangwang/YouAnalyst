import assert from "node:assert/strict";
import test from "node:test";
import { edgeOpacity, fadeEdge } from "../../src/lib/knowledge-graph/edge-visibility";

const edges = [
  { id: "out", source: "a", target: "b" },
  { id: "in", source: "c", target: "a" },
  { id: "other", source: "c", target: "d" },
];

test("overview is empty; selection reveals incoming and outgoing relationships only", () => {
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "", false)), [0, 0, 0]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "a", "", false)), [.28, .28, 0]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "isolated", "", false)), [0, 0, 0]);
});

test("all-connections mode and evidence selection remain available", () => {
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "", true)), [.07, .07, .07]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "a", "out", true)), [.65, .28, .07]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "other", false)), [0, 0, .65]);
});

test("hover previews both directions and leaving restores selection or overview", () => {
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "", false, "a")), [.28, .28, 0]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "", false, "")), [0, 0, 0]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "a", "", false, "d")), [.28, .28, .28]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "a", "", false, "")), [.28, .28, 0]);
  assert.deepEqual(edges.map(e => edgeOpacity(e, "", "out", true, "c")), [.65, .28, .28]);
});

test("transitions settle, reverse continuously, and respect reduced motion", () => {
  const first = fadeEdge(0, .5, 1 / 60, false);
  assert(first > 0 && first < .5);
  assert(fadeEdge(first, 0, 1 / 60, false) < first);
  let value = 0;
  for (let frame = 0; frame < 24; frame++) value = fadeEdge(value, .5, 1 / 60, false);
  assert.equal(value, .5);
  for (let frame = 0; frame < 24; frame++) value = fadeEdge(value, 0, 1 / 60, false);
  assert.equal(value, 0);
  assert.equal(fadeEdge(0, .5, 0, true), .5);
  assert.equal(fadeEdge(.5, 0, 0, true), 0);
});
