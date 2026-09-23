import test from 'node:test';
import assert from 'node:assert/strict';
import { createViews, nextView, handleViewerKey } from '../../src/core/views.mjs';

test('AOV groups and every original channel remain selectable in stable order', () => {
  const parts = [{ name: '', channels: ['ViewLayer.Normal.Z', 'ViewLayer.Combined.G', 'ViewLayer.Combined.B', 'ViewLayer.Normal.X', 'ViewLayer.Combined.R', 'ViewLayer.Depth.Z', 'ViewLayer.Normal.Y'] }];
  const views = createViews(parts);
  assert.equal(views[0].label, 'ViewLayer.Combined');
  assert.deepEqual(views[0].components, [4, 1, 2]);
  assert.deepEqual(views.filter(v => v.kind === 'channel').map(v => v.label), [...parts[0].channels].sort());
  assert.equal(views.filter(v => v.kind === 'group').length, 2);
  assert.equal(nextView(views.length - 1, views.length), 0);
  assert.equal(nextView(0, 0), 0);
});

test('S cycles once per press and A returns to the same selection', () => {
  let state = { selected: 0, grid: false };
  state = handleViewerKey(state, { key: 's' }, 3);
  assert.equal(state.selected, 1);
  assert.equal(handleViewerKey(state, { key: 's', repeat: true }, 3).selected, 1);
  state = handleViewerKey(state, { key: 'a' }, 3);
  assert.equal(state.grid, true);
  state = handleViewerKey(state, { key: 'a' }, 3);
  assert.deepEqual(state, { selected: 1, grid: false });
  assert.equal(handleViewerKey(state, { key: 'a', editable: true }, 3).grid, false);
});

test('multipart Blender names are not duplicated in preview labels',()=>{
  const views=createViews([{name:'ViewLayer.Combined',channels:['ViewLayer.Combined.B','ViewLayer.Combined.G','ViewLayer.Combined.R']},{name:'ViewLayer.Depth',channels:['ViewLayer.Depth.Z']}]);
  assert.equal(views[0].label,'ViewLayer.Combined');
  assert.ok(views.some(v=>v.label==='ViewLayer.Depth.Z'));
  assert.ok(views.every(v=>!v.label.includes(' / ViewLayer')));
});
