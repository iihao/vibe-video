import test from 'node:test';
import assert from 'node:assert/strict';
import { fitVoiceTiming, speechText, ttsFileName, listVoices } from '../server/tts.mjs';

const voiceResult = (durationMs) => ({
  samples: new Float32Array(0),
  sampleRate: 24000,
  durationMs,
  words: [
    { text: '你', beginMs: 0, endMs: 1000 },
    { text: '好', beginMs: 1000, endMs: 2000 },
  ],
});

test('speechText strips trailing punctuation and joins title with subtitle', () => {
  assert.equal(
    speechText({ title: '你的「一秒」，和别人不一样长。', subtitle: '在卫星上的时钟。' }),
    '你的「一秒」，和别人不一样长，在卫星上的时钟',
  );
  assert.equal(speechText({ title: '时间，并不平等。', subtitle: '' }), '时间，并不平等');
  assert.equal(speechText({ title: '', subtitle: '' }), '');
});

test('fitVoiceTiming keeps short narration untouched', () => {
  const fit = fitVoiceTiming(voiceResult(2000), 4);
  assert.equal(fit.tempo, 1);
  assert.equal(fit.overflow, false);
  assert.deepEqual(fit.words[0], { text: '你', beginMs: 0, endMs: 1000 });
});

test('fitVoiceTiming accelerates long narration and scales word timestamps', () => {
  const fit = fitVoiceTiming(voiceResult(5000), 4);
  assert.equal(Number(fit.tempo.toFixed(2)), 1.25);
  assert.equal(fit.fittedMs, 4000);
  assert.equal(fit.overflow, false);
  assert.equal(fit.words[1].endMs, 1600);
});

test('fitVoiceTiming reports overflow when even 1.6x does not fit', () => {
  const fit = fitVoiceTiming(voiceResult(10000), 4);
  assert.equal(fit.tempo, 1.6);
  assert.equal(fit.overflow, true);
  assert.equal(Math.round(fit.fittedMs), 6250);
});

test('ttsFileName never emits path separators or traversal segments', () => {
  const name = ttsFileName('../../etc', 'scene/../../1');
  assert.ok(!name.includes('/'));
  assert.ok(!name.includes('..'));
  assert.match(name, /^[A-Za-z0-9_.-]+\.wav$/);
});

test('voices list is non-empty and has stable ids', () => {
  const voices = listVoices();
  assert.ok(voices.length >= 4);
  assert.ok(voices.every((v) => v.id && v.name));
});
