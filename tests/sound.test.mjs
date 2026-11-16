import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthTrack } from '../shared/sound.mjs';
import { createSfxEvents, sfxClips } from '../shared/sfx.mjs';

const scenes = [
  { start: 0, end: 6 },
  { start: 6, end: 12 },
  { start: 12, end: 18 },
];

test('sound effects are scheduled on exact scene boundaries with varied licensed clips', () => {
  const events = createSfxEvents(scenes, 'cinematic');
  assert.ok(events.some((event) => event.at === 6));
  assert.ok(events.some((event) => event.at === 12));
  assert.ok(new Set(events.map((event) => event.id)).size > 2);
  assert.ok(events.every((event) => sfxClips.some((clip) => clip.id === event.id)));
  assert.deepEqual(createSfxEvents(scenes, 'off'), []);
});

test('beat accents follow the scene timeline and can be disabled independently', () => {
  const track = synthTrack(18, { mode: 'none', scenes });
  const cutStart = 6 * 44100;
  const cutPeak = Math.max(...track.subarray(cutStart + 1, cutStart + 2205).map(Math.abs));
  assert.ok(cutPeak > 0.2);

  const silent = synthTrack(18, { mode: 'none', scenes, rhythm: false });
  assert.equal(
    silent.some((sample) => sample !== 0),
    false,
  );
});
