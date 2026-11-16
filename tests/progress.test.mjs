import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSceneDrafts } from '../server/ai/progress.mjs';
import { makeDemo } from '../shared/catalog.mjs';

test('incremental drafts only expose closed scene objects, including across escaped JSON strings', () => {
  const scenes = makeDemo().scenes.map((scene) => ({
    ...scene,
    note: '括号 { [ ] } 与转义 " 和 \\ 都只是文本',
  }));
  const prefix = '{"title":"test","scenes":[';
  const first = JSON.stringify(scenes[0]);
  const second = JSON.stringify(scenes[1]);
  assert.deepEqual(readSceneDrafts(prefix + first.slice(0, -1)), []);
  assert.deepEqual(readSceneDrafts(prefix + first + ',' + second.slice(0, -1)), [scenes[0]]);
  assert.deepEqual(readSceneDrafts(prefix + first + ',' + second + ']}'), scenes.slice(0, 2));
});
test('invalid drafts are rejected; fenced output works and nested arrays do not become scenes', () => {
  const scene = makeDemo().scenes[0];
  const raw = JSON.stringify({ scenes: [{ ...scene, visual: 'execute-code' }, scene] });
  assert.deepEqual(readSceneDrafts('```json\n' + raw + '\n```'), [scene]);
  assert.deepEqual(readSceneDrafts(JSON.stringify({ other: { scenes: [scene] } })), []);
  assert.equal(readSceneDrafts(JSON.stringify({ scenes: Array(20).fill(scene) })).length, 12);
});
