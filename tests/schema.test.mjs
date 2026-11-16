import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSchema, configSchema } from '../server/schema.mjs';
import { makeDemo, defaultConfig } from '../shared/catalog.mjs';

test('all durations and aspects produce contiguous, valid storyboards', () => {
  for (const duration of [30, 60, 90, 120])
    for (const aspect of ['16:9', '9:16', '1:1']) {
      const p = makeDemo({ ...defaultConfig, duration, aspect });
      assert.equal(projectSchema.safeParse(p).success, true);
      assert.equal(p.scenes.at(-1).end, duration);
    }
});
test('all six visual styles are valid project formats', () => {
  for (const style of ['cosmos', 'blueprint', 'editorial', 'minimal', 'pixel', 'claude']) {
    const project = makeDemo({ ...defaultConfig, style });
    assert.equal(configSchema.safeParse(project).success, true, `${style} config`);
    assert.equal(projectSchema.safeParse(project).success, true, `${style} project`);
  }
});
test('gaps, overlaps and timelines beyond total duration are rejected', () => {
  for (const [start, end] of [
    [13, 24],
    [11, 24],
    [12, 120],
    [24, 12],
  ]) {
    const p = makeDemo();
    p.scenes[1] = { ...p.scenes[1], start, end };
    assert.equal(projectSchema.safeParse(p).success, false);
  }
});
test('source links cannot execute javascript or access local files', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>bad</script>',
  ]) {
    const p = makeDemo();
    p.sources[0].url = url;
    assert.equal(projectSchema.safeParse(p).success, false);
  }
});
test('unbounded renders, code visual types and blank topics are rejected', () => {
  assert.equal(configSchema.safeParse({ ...defaultConfig, duration: 100000 }).success, false);
  assert.equal(configSchema.safeParse({ ...defaultConfig, topic: ' ' }).success, false);
  const p = makeDemo();
  p.scenes[0].visual = '<script>alert(1)</script>';
  assert.equal(projectSchema.safeParse(p).success, false);
});
