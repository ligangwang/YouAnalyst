import assert from 'node:assert/strict';
import test from 'node:test';
import {placeTreeLabel} from '../src/lib/ui/knowledge-graph/tree-label-placement';
const box=(left:number,top:number,width=120,height=30)=>({left,top,width,height,right:left+width,bottom:top+height});
const viewport=box(0,0,600,400);
test('browser rectangle getters retain their dimensions when reserving label space',()=>{
  const rectangle=Object.create(box(200,100));
  const first=placeTreeLabel(rectangle,[],viewport)!;
  assert.equal(first.box.width,120);assert.equal(first.box.height,30);
  assert.notEqual(placeTreeLabel(rectangle,[first.box],viewport)?.y,0);
});
test('company labels move clear of reserved headings and retain a valid previous lane',()=>{
  const heading=box(200,150),company=box(220,150);
  const placed=placeTreeLabel(company,[heading],viewport)!;
  assert.equal(placed.y,-40);
  assert.equal(placeTreeLabel(company,[],viewport,placed)?.y,-40);
});
test('crowded labels fall back to dots instead of overlapping or moving far from their stems',()=>{
  assert.equal(placeTreeLabel(box(220,150),[box(0,0,600,400)],viewport),null);
});
test('labels respect the canvas edges and leave room above and below the tree',()=>{
  const placed=placeTreeLabel(box(220,370),[],viewport)!;
  assert(placed.box.bottom<=384);
  assert.equal(placeTreeLabel(box(-20,100),[],viewport),null);
});
